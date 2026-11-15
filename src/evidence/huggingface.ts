import {
  digestCanonicalJson,
  sha256Hex,
} from "../qualification/canonical.js";
import {
  classifyArtifactFile,
  normalizeArtifactManifest,
} from "./artifact-manifest.js";
import {
  assessRemoteCodeRequirement,
} from "./remote-code.js";
import type {
  ArtifactFileIdentity,
  EvidenceRecord,
  HuggingFaceModelEvidenceBundle,
  LicenseEvidencePayload,
} from "./types.js";

export interface HuggingFaceCollectorOptions {
  endpoint?: string;
  token?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxTextBytes?: number;
  maxFiles?: number;
  now?: () => Date;
  retryAttempts?: number;
  retryBaseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

interface ModelInfoResponse {
  id?: unknown;
  sha?: unknown;
  siblings?: unknown;
  cardData?: unknown;
  config?: unknown;
  transformersInfo?: unknown;
  tags?: unknown;
  safetensors?: unknown;
  securityRepoStatus?: unknown;
  security?: unknown;
  author?: unknown;
  pipeline_tag?: unknown;
  library_name?: unknown;
  gated?: unknown;
}

interface RepoSiblingResponse {
  rfilename?: unknown;
}

export class HuggingFaceEvidenceError extends Error {
  readonly code: string;
  readonly status: number | null;

  constructor(
    code: string,
    message: string,
    status: number | null = null,
    cause?: unknown,
  ) {
    super(message);
    this.name = "HuggingFaceEvidenceError";
    this.code = code;
    this.status = status;

    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

function describeNetworkError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const parts = [`${error.name}: ${error.message}`];
  const direct = error as Error & {
    cause?: unknown;
    code?: unknown;
    errors?: unknown[];
  };

  if (direct.code !== undefined) {
    parts.push(`code=${String(direct.code)}`);
  }

  if (direct.cause instanceof Error) {
    const cause = direct.cause as Error & { code?: unknown };
    parts.push(
      `cause=${cause.name}: ${cause.message}${
        cause.code !== undefined ? ` [${String(cause.code)}]` : ""
      }`,
    );
  }

  if (Array.isArray(direct.errors) && direct.errors.length > 0) {
    const summaries = direct.errors.slice(0, 4).map((item) => {
      if (item instanceof Error) {
        const child = item as Error & { code?: unknown };
        return `${child.name}: ${child.message}${
          child.code !== undefined ? ` [${String(child.code)}]` : ""
        }`;
      }
      return String(item);
    });

    parts.push(`errors=${summaries.join(" | ")}`);
  }

  return parts.join("; ");
}

function encodeRepositoryPath(repoId: string): string {
  const parts = repoId.split("/");
  if (
    parts.length !== 2 ||
    parts.some((part) => part.trim() === "")
  ) {
    throw new HuggingFaceEvidenceError(
      "HF_INVALID_REPOSITORY",
      `Expected repository in namespace/name form, received "${repoId}"`,
    );
  }

  return parts.map(encodeURIComponent).join("/");
}

function encodeRevision(revision: string): string {
  if (revision.trim() === "") {
    throw new HuggingFaceEvidenceError(
      "HF_INVALID_REVISION",
      "Revision must be non-empty",
    );
  }

  return encodeURIComponent(revision);
}

function sanitizeHeaderValue(value: string | null): string | null {
  if (!value) return null;
  return value.replace(/^W\//, "").replace(/^"|"$/g, "");
}

function parseIntegerHeader(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function makeHeaders(token: string | undefined): Headers {
  const headers = new Headers({
    "User-Agent": "Admissary/0.2 evidence-collector",
    "Accept": "application/json,text/plain;q=0.9,*/*;q=0.1",
  });

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  return headers;
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetchImpl(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError")
    ) {
      throw new HuggingFaceEvidenceError(
        "HF_TIMEOUT",
        `Hugging Face request timed out: ${url}; ${describeNetworkError(error)}`,
        null,
        error,
      );
    }

    throw new HuggingFaceEvidenceError(
      "HF_NETWORK_ERROR",
      `Hugging Face request failed: ${url}; ${describeNetworkError(error)}`,
      null,
      error,
    );
  } finally {
    clearTimeout(timer);
  }
}

function retryableHttpStatus(status: number): boolean {
  return (
    status === 408 ||
    status === 425 ||
    status === 429 ||
    (status >= 500 && status <= 599)
  );
}

function retryableEvidenceError(error: unknown): boolean {
  return (
    error instanceof HuggingFaceEvidenceError &&
    (error.code === "HF_NETWORK_ERROR" || error.code === "HF_TIMEOUT")
  );
}

async function fetchWithRetry(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  attempts: number,
  baseDelayMs: number,
  sleep: (ms: number) => Promise<void>,
): Promise<Response> {
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 6) {
    throw new RangeError("retryAttempts must be an integer between 1 and 6");
  }

  if (!Number.isFinite(baseDelayMs) || baseDelayMs < 0 || baseDelayMs > 10_000) {
    throw new RangeError("retryBaseDelayMs must be between 0 and 10000");
  }

  let lastError: unknown = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchWithTimeout(
        fetchImpl,
        url,
        init,
        timeoutMs,
      );

      if (
        retryableHttpStatus(response.status) &&
        attempt < attempts
      ) {
        try {
          await response.body?.cancel();
        } catch {
          // Best-effort body disposal before retry.
        }

        const delay = Math.min(
          baseDelayMs * (2 ** (attempt - 1)),
          4_000,
        );
        await sleep(delay);
        continue;
      }

      return response;
    } catch (error) {
      lastError = error;

      if (
        !retryableEvidenceError(error) ||
        attempt >= attempts
      ) {
        throw error;
      }

      const delay = Math.min(
        baseDelayMs * (2 ** (attempt - 1)),
        4_000,
      );
      await sleep(delay);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new HuggingFaceEvidenceError(
        "HF_NETWORK_ERROR",
        `Hugging Face request exhausted retries: ${url}`,
      );
}

function requireSuccess(
  response: Response,
  url: string,
): void {
  if (response.ok) return;

  if (response.status === 404) {
    throw new HuggingFaceEvidenceError(
      "HF_NOT_FOUND",
      `Hugging Face resource was not found: ${url}`,
      response.status,
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new HuggingFaceEvidenceError(
      "HF_ACCESS_DENIED",
      `Hugging Face access denied: ${url}`,
      response.status,
    );
  }

  if (response.status === 429) {
    throw new HuggingFaceEvidenceError(
      "HF_RATE_LIMIT",
      `Hugging Face rate limit reached: ${url}`,
      response.status,
    );
  }

  throw new HuggingFaceEvidenceError(
    "HF_HTTP_ERROR",
    `Hugging Face returned HTTP ${response.status}: ${url}`,
    response.status,
  );
}

async function readBoundedBytes(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  const contentLength = parseIntegerHeader(
    response.headers.get("content-length"),
  );
  if (contentLength !== null && contentLength > maxBytes) {
    throw new HuggingFaceEvidenceError(
      "HF_TEXT_TOO_LARGE",
      `Text evidence exceeds ${maxBytes} bytes`,
      response.status,
    );
  }

  if (!response.body) {
    return new Uint8Array();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new HuggingFaceEvidenceError(
        "HF_TEXT_TOO_LARGE",
        `Text evidence exceeded ${maxBytes} bytes while streaming`,
        response.status,
      );
    }

    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytes;
}

function makeEvidenceRecord<T>(
  kind: EvidenceRecord<T>["kind"],
  sourceUri: string,
  sourceRevision: string,
  capturedAt: string,
  payload: T,
): EvidenceRecord<T> {
  return {
    id: `${kind.toLowerCase()}:${digestCanonicalJson({
      sourceUri,
      sourceRevision,
      payload,
    }).slice(0, 24)}`,
    kind,
    sourceUri,
    sourceRevision,
    capturedAt,
    contentDigest: digestCanonicalJson(payload),
    payload,
  };
}

function cardDataRecord(
  raw: ModelInfoResponse,
): Record<string, unknown> | null {
  return (
    typeof raw.cardData === "object" &&
    raw.cardData !== null &&
    !Array.isArray(raw.cardData)
  )
    ? raw.cardData as Record<string, unknown>
    : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== ""
    ? value
    : null;
}

function licensePayload(
  raw: ModelInfoResponse,
  filePath: string | null,
  text: string | null,
): LicenseEvidencePayload | null {
  const cardData = cardDataRecord(raw);

  const declaredIdentifier = nullableString(cardData?.license);
  const declaredName = nullableString(cardData?.license_name);
  const declaredLink = nullableString(cardData?.license_link);

  if (
    declaredIdentifier === null &&
    declaredName === null &&
    declaredLink === null &&
    filePath === null &&
    text === null
  ) {
    return null;
  }

  return {
    declaredIdentifier,
    declaredName,
    declaredLink,
    filePath,
    text,
  };
}

function stableModelMetadata(
  raw: ModelInfoResponse,
  repository: string,
): Record<string, unknown> {
  return {
    repository,
    author: raw.author ?? null,
    gated: raw.gated ?? null,
    pipelineTag: raw.pipeline_tag ?? null,
    libraryName: raw.library_name ?? null,
    cardData: raw.cardData ?? null,
    config: raw.config ?? null,
    transformersInfo: raw.transformersInfo ?? null,
    tags: raw.tags ?? null,
    safetensors: raw.safetensors ?? null,
    securityRepoStatus:
      raw.securityRepoStatus ??
      raw.security ??
      null,
  };
}

function siblingPaths(raw: ModelInfoResponse): string[] {
  if (!Array.isArray(raw.siblings)) return [];

  const paths = raw.siblings
    .map((item) => {
      if (
        typeof item === "object" &&
        item !== null &&
        typeof (item as RepoSiblingResponse).rfilename === "string"
      ) {
        return (item as RepoSiblingResponse).rfilename as string;
      }
      return null;
    })
    .filter((value): value is string => value !== null);

  return [...new Set(paths)].sort();
}

function chooseLicensePath(paths: readonly string[]): string | null {
  const priority = [
    "LICENSE",
    "LICENSE.md",
    "LICENSE.txt",
    "COPYING",
    "COPYING.md",
    "COPYING.txt",
  ];

  const byLower = new Map(paths.map((path) => [path.toLowerCase(), path]));

  for (const candidate of priority) {
    const exact = byLower.get(candidate.toLowerCase());
    if (exact) return exact;
  }

  return null;
}

function chooseConfigPath(paths: readonly string[]): string | null {
  const exact = paths.find((path) => path.toLowerCase() === "config.json");
  return exact ?? null;
}

function chooseModelCardPath(paths: readonly string[]): string | null {
  const exact = paths.find((path) => path.toLowerCase() === "readme.md");
  return exact ?? null;
}

export class HuggingFaceEvidenceCollector {
  readonly endpoint: string;
  readonly token: string | undefined;
  readonly fetchImpl: typeof fetch;
  readonly timeoutMs: number;
  readonly maxTextBytes: number;
  readonly maxFiles: number;
  readonly now: () => Date;
  readonly retryAttempts: number;
  readonly retryBaseDelayMs: number;
  readonly sleep: (ms: number) => Promise<void>;

  constructor(options: HuggingFaceCollectorOptions = {}) {
    this.endpoint = (options.endpoint ?? "https://huggingface.co")
      .replace(/\/+$/, "");
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.maxTextBytes = options.maxTextBytes ?? 2_000_000;
    this.maxFiles = options.maxFiles ?? 500;
    this.now = options.now ?? (() => new Date());
    this.retryAttempts = options.retryAttempts ?? 3;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 300;
    this.sleep =
      options.sleep ??
      ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async collect(
    repository: string,
    requestedRevision = "main",
  ): Promise<HuggingFaceModelEvidenceBundle> {
    const repoPath = encodeRepositoryPath(repository);
    const revisionPath = encodeRevision(requestedRevision);
    const headers = makeHeaders(this.token);

    const modelInfoUrl =
      `${this.endpoint}/api/models/${repoPath}/revision/${revisionPath}?securityStatus=true`;

    const modelResponse = await fetchWithRetry(
      this.fetchImpl,
      modelInfoUrl,
      {
        method: "GET",
        headers,
        redirect: "follow",
        cache: "no-store",
      },
      this.timeoutMs,
      this.retryAttempts,
      this.retryBaseDelayMs,
      this.sleep,
    );
    requireSuccess(modelResponse, modelInfoUrl);

    let raw: ModelInfoResponse;
    try {
      raw = (await modelResponse.json()) as ModelInfoResponse;
    } catch {
      throw new HuggingFaceEvidenceError(
        "HF_SCHEMA_ERROR",
        "Hugging Face model metadata was not valid JSON",
        modelResponse.status,
      );
    }

    const resolvedRevision =
      typeof raw.sha === "string" && /^[a-f0-9]{40}$/i.test(raw.sha)
        ? raw.sha
        : null;

    if (!resolvedRevision) {
      throw new HuggingFaceEvidenceError(
        "HF_SCHEMA_ERROR",
        "Hugging Face model metadata did not contain a 40-character repository SHA",
        modelResponse.status,
      );
    }

    if (/^[a-f0-9]{40}$/i.test(requestedRevision) && resolvedRevision.toLowerCase() !== requestedRevision.toLowerCase()) {
      throw new HuggingFaceEvidenceError("HF_REVISION_MISMATCH", "Requested immutable revision differs from returned SHA");
    }
    if (raw.id !== undefined && raw.id !== repository) {
      throw new HuggingFaceEvidenceError("HF_REPOSITORY_MISMATCH", "Returned repository identity differs from requested repository");
    }
    const paths = siblingPaths(raw);
    if (paths.length === 0) {
      throw new HuggingFaceEvidenceError(
        "HF_SCHEMA_ERROR",
        "Hugging Face model metadata did not contain repository files",
        modelResponse.status,
      );
    }

    if (paths.length > this.maxFiles) {
      throw new HuggingFaceEvidenceError(
        "HF_TOO_MANY_FILES",
        `Repository contains ${paths.length} files, exceeding collector limit ${this.maxFiles}`,
      );
    }

    const capturedAt = this.now().toISOString();

    const fileManifest = await this.collectFileManifest(
      repository,
      resolvedRevision,
      paths,
    );

    const modelCardPath = chooseModelCardPath(paths);
    const licensePath = chooseLicensePath(paths);
    const configPath = chooseConfigPath(paths);

    const [modelCardText, licenseText, configText] = await Promise.all([
      modelCardPath
        ? this.fetchTextFile(repository, resolvedRevision, modelCardPath)
        : Promise.resolve(null),
      licensePath
        ? this.fetchTextFile(repository, resolvedRevision, licensePath)
        : Promise.resolve(null),
      configPath
        ? this.fetchTextFile(repository, resolvedRevision, configPath)
        : Promise.resolve(null),
    ]);

    let parsedConfig: Record<string, unknown> | null = null;
    if (configText !== null) {
      try {
        const value = JSON.parse(configText);
        if (typeof value !== "object" || value === null || Array.isArray(value)) {
          throw new Error("config root must be an object");
        }
        parsedConfig = value as Record<string, unknown>;
      } catch (error) {
        throw new HuggingFaceEvidenceError(
          "HF_CONFIG_SCHEMA_ERROR",
          `config.json could not be parsed as an object: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    const remoteCodeAssessment = assessRemoteCodeRequirement(
      parsedConfig,
      fileManifest,
    );

    const metadataPayload = stableModelMetadata(raw, repository);

    const modelMetadata = makeEvidenceRecord(
      "MODEL_METADATA",
      modelInfoUrl,
      resolvedRevision,
      capturedAt,
      metadataPayload,
    );

    const manifestEvidence = makeEvidenceRecord(
      "FILE_MANIFEST",
      `${this.endpoint}/${repoPath}/tree/${resolvedRevision}`,
      resolvedRevision,
      capturedAt,
      fileManifest,
    );

    const modelCard = modelCardText === null || modelCardPath === null
      ? null
      : makeEvidenceRecord(
          "MODEL_CARD",
          this.resolveFileUrl(repository, resolvedRevision, modelCardPath),
          resolvedRevision,
          capturedAt,
          modelCardText,
        );

    const resolvedLicensePayload = licensePayload(
      raw,
      licensePath,
      licenseText,
    );

    const license = resolvedLicensePayload === null
      ? null
      : makeEvidenceRecord(
          "LICENSE",
          licensePath
            ? this.resolveFileUrl(repository, resolvedRevision, licensePath)
            : modelInfoUrl,
          resolvedRevision,
          capturedAt,
          resolvedLicensePayload,
        );

    const config = parsedConfig === null || configPath === null
      ? null
      : makeEvidenceRecord(
          "CONFIG",
          this.resolveFileUrl(repository, resolvedRevision, configPath),
          resolvedRevision,
          capturedAt,
          parsedConfig,
        );

    const remoteCode = makeEvidenceRecord(
      "REMOTE_CODE",
      `admissary://remote-code/${repository}@${resolvedRevision}`,
      resolvedRevision,
      capturedAt,
      remoteCodeAssessment,
    );

    const bundleWithoutDigest = {
      schema: "admissary-hf-evidence/v1" as const,
      repository,
      requestedRevision,
      resolvedRevision,
      capturedAt,
      source: "huggingface" as const,
      modelMetadata,
      fileManifest: manifestEvidence,
      modelCard,
      license,
      config,
      remoteCode,
    };

    const evidenceIdentity = {
      schema: bundleWithoutDigest.schema,
      repository: bundleWithoutDigest.repository,
      resolvedRevision: bundleWithoutDigest.resolvedRevision,
      modelMetadata: modelMetadata.contentDigest,
      fileManifest: manifestEvidence.contentDigest,
      modelCard: modelCard?.contentDigest ?? null,
      license: license?.contentDigest ?? null,
      config: config?.contentDigest ?? null,
      remoteCode: remoteCode.contentDigest,
    };

    return {
      ...bundleWithoutDigest,
      bundleDigest: digestCanonicalJson(evidenceIdentity),
    };
  }

  private resolveFileUrl(
    repository: string,
    resolvedRevision: string,
    path: string,
  ): string {
    const repoPath = encodeRepositoryPath(repository);
    const encodedPath = path
      .split("/")
      .map(encodeURIComponent)
      .join("/");

    return `${this.endpoint}/${repoPath}/resolve/${resolvedRevision}/${encodedPath}`;
  }

  private async collectFileManifest(
    repository: string,
    resolvedRevision: string,
    paths: readonly string[],
  ): Promise<ArtifactFileIdentity[]> {
    const concurrency = 6;
    const output: ArtifactFileIdentity[] = new Array(paths.length);
    let index = 0;

    const worker = async (): Promise<void> => {
      while (true) {
        const current = index;
        index += 1;

        if (current >= paths.length) return;

        const path = paths[current]!;
        output[current] = await this.fetchFileIdentity(
          repository,
          resolvedRevision,
          path,
        );
      }
    };

    await Promise.all(
      Array.from(
        { length: Math.min(concurrency, paths.length) },
        () => worker(),
      ),
    );

    return normalizeArtifactManifest(output);
  }

  private async fetchFileIdentity(
    repository: string,
    resolvedRevision: string,
    path: string,
  ): Promise<ArtifactFileIdentity> {
    const url = this.resolveFileUrl(
      repository,
      resolvedRevision,
      path,
    );

    const response = await fetchWithRetry(
      this.fetchImpl,
      url,
      {
        method: "HEAD",
        headers: makeHeaders(this.token),
        redirect: "manual",
        cache: "no-store",
      },
      this.timeoutMs,
      this.retryAttempts,
      this.retryBaseDelayMs,
      this.sleep,
    );

    if (!(response.ok || (response.status >= 300 && response.status < 400))) {
      requireSuccess(response, url);
    }

    const linkedEtag = sanitizeHeaderValue(
      response.headers.get("x-linked-etag"),
    );
    const etag = linkedEtag ?? sanitizeHeaderValue(
      response.headers.get("etag"),
    );

    const linkedSize = parseIntegerHeader(
      response.headers.get("x-linked-size"),
    );
    const size = linkedSize ?? parseIntegerHeader(
      response.headers.get("content-length"),
    );

    const repoCommit = response.headers.get("x-repo-commit");

    if (repoCommit && repoCommit !== resolvedRevision) {
      throw new HuggingFaceEvidenceError(
        "HF_REVISION_RACE",
        `File ${path} resolved to ${repoCommit}, expected ${resolvedRevision}`,
        response.status,
      );
    }

    return {
      path,
      role: classifyArtifactFile(path),
      size,
      etag,
      storageIdentity: linkedEtag ?? etag,
      repoCommit: repoCommit ?? null,
    };
  }

  private async fetchTextFile(
    repository: string,
    resolvedRevision: string,
    path: string,
  ): Promise<string> {
    const url = this.resolveFileUrl(
      repository,
      resolvedRevision,
      path,
    );

    const response = await fetchWithRetry(
      this.fetchImpl,
      url,
      {
        method: "GET",
        headers: makeHeaders(this.token),
        redirect: "follow",
        cache: "no-store",
      },
      this.timeoutMs,
      this.retryAttempts,
      this.retryBaseDelayMs,
      this.sleep,
    );
    requireSuccess(response, url);

    const bytes = await readBoundedBytes(
      response,
      this.maxTextBytes,
    );

    const text = new TextDecoder("utf-8", {
      fatal: false,
    }).decode(bytes);

    // We compute the raw byte hash here as a second, transport-level identity.
    // The EvidenceRecord payload digest remains canonical-JSON based.
    void sha256Hex(bytes);

    return text;
  }
}
