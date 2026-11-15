import { acceptedRealEvidence } from "./accepted-completion.mjs";
import { liveCandidateRecords } from "./live-candidate-evidence.mjs";
import { verifyProof, acceptedHistorical } from "./artifact-integrity.mjs";
import {
  createServer,
} from "node:http";
import {
  appendFile,
  readFile,
  readdir,
} from "node:fs/promises";
import {
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  extname,
  join,
  normalize,
} from "node:path";

import {
  buildAdmissaryGuidanceMapping,
  buildQualificationManifest,
  ContinuousAssuranceService,
  digestCanonicalJson, sha256Hex,
  JsonAssuranceRepository,
  JsonProductRepository,
  ProductApplicationService,
  parseDeploymentVerificationContext,
  selectCandidates,
  verifyHistoricalAttestationProof,
  verifyDeploymentManifest,
  verifySignedQualificationAttestation,
} from "../dist/index.js";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const DEFAULT_RATE_LIMIT = {
  windowMs: 60_000,
  max: 120,
};

function nowIso() {
  return new Date().toISOString();
}

function securityHeaders({
  requestId,
  secureTransport = false,
  rateLimit = null,
}) {
  const headers = {
    "cache-control": "no-store",
    "content-security-policy":
      "default-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'",
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-resource-policy": "same-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "x-request-id": requestId,
  };

  if (secureTransport) {
    headers["strict-transport-security"] =
      "max-age=31536000; includeSubDomains";
  }

  if (rateLimit) {
    headers["ratelimit-limit"] =
      String(rateLimit.limit);
    headers["ratelimit-remaining"] =
      String(rateLimit.remaining);
    headers["ratelimit-reset"] =
      String(rateLimit.resetSeconds);

    if (rateLimit.blocked) {
      headers["retry-after"] =
        String(
          Math.max(
            1,
            rateLimit.resetSeconds,
          ),
        );
    }
  }

  return headers;
}

function response(
  res,
  status,
  body,
  {
    contentType =
      "text/plain; charset=utf-8",
    requestId,
    secureTransport = false,
    rateLimit = null,
    extraHeaders = {},
  },
) {
  res.writeHead(
    status,
    {
      "content-type":
        contentType,
      ...securityHeaders({
        requestId,
        secureTransport,
        rateLimit,
      }),
      ...extraHeaders,
    },
  );

  res.end(body);
}

function json(
  res,
  status,
  body,
  options,
) {
  response(
    res,
    status,
    JSON.stringify(body),
    {
      ...options,
      contentType:
        "application/json; charset=utf-8",
    },
  );
}

function text(
  res,
  status,
  body,
  options,
) {
  response(
    res,
    status,
    body,
    options,
  );
}

function clientIp(req) {
  return (
    req.socket?.remoteAddress ??
    "unknown"
  );
}

function safePathForAudit(url) {
  return url.pathname;
}

function constantTimeTokenEqual(
  left,
  right,
) {
  if (
    typeof left !== "string" ||
    typeof right !== "string"
  ) {
    return false;
  }

  const a = Buffer.from(
    left,
    "utf8",
  );

  const b = Buffer.from(
    right,
    "utf8",
  );

  if (a.length !== b.length) {
    return false;
  }

  return timingSafeEqual(a, b);
}

function parseBearerToken(req) {
  const raw =
    req.headers.authorization;

  if (
    typeof raw !== "string"
  ) {
    return null;
  }

  const match =
    /^Bearer\s+(.+)$/i.exec(
      raw.trim(),
    );

  return match?.[1] ?? null;
}

function roleForToken(
  token,
  authTokens,
) {
  if (!token) {
    return null;
  }

  for (
    const [candidate, role] of
    Object.entries(authTokens)
  ) {
    if (
      constantTimeTokenEqual(
        token,
        candidate,
      )
    ) {
      return role;
    }
  }

  return null;
}

class FixedWindowRateLimiter {
  constructor(
    {
      windowMs =
        DEFAULT_RATE_LIMIT.windowMs,
      max =
        DEFAULT_RATE_LIMIT.max,
    } = {},
  ) {
    this.windowMs =
      windowMs;
    this.max =
      max;
    this.entries =
      new Map();
  }

  consume(key) {
    const now = Date.now();
    for (const [k, entry] of this.entries) if (now >= entry.resetAt) this.entries.delete(k);
    // At capacity use one shared overflow bucket, never evict an active bucket.
    if (!this.entries.has(key) && this.entries.size >= 4096) key = "__overflow__";
    const current = this.entries.get(key);

    let entry = current;

    if (
      !entry ||
      now >= entry.resetAt
    ) {
      entry = {
        count: 0,
        resetAt:
          now + this.windowMs,
      };
    }

    entry.count += 1;
    this.entries.set(
      key,
      entry,
    );

    const remaining =
      Math.max(
        0,
        this.max -
          entry.count,
      );

    const resetSeconds =
      Math.max(
        1,
        Math.ceil(
          (entry.resetAt - now) /
            1000,
        ),
      );

    return {
      blocked:
        entry.count >
        this.max,
      limit:
        this.max,
      remaining,
      resetSeconds,
    };
  }
}

async function audit(
  entry,
  auditFile,
) {
  const sanitized = {
    schema:
      "admissary-http-audit/v1",
    occurredAt:
      nowIso(),
    requestId:
      entry.requestId,
    method:
      entry.method,
    path:
      entry.path,
    status:
      entry.status,
    actorRole:
      entry.actorRole ??
      "PUBLIC",
    remoteAddress:
      entry.remoteAddress,
    durationMs:
      entry.durationMs,
    event:
      entry.event,
  };

  const line =
    JSON.stringify(sanitized);

  console.log(
    `ADMISSARY_HTTP_AUDIT=${line}`,
  );

  if (auditFile) {
    await appendFile(
      auditFile,
      line + "\n",
      "utf8",
    );
  }
}

async function latestResult(prefix) { return acceptedHistorical(prefix); }

async function firstReadableJson(
  paths,
) {
  let lastError = null;

  for (const path of paths) {
    if (!path) continue;

    try {
      return {
        path,
        value:
          JSON.parse(
            await readFile(
              path,
              "utf8",
            ),
          ),
      };
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      lastError = error;
    }
  }

  throw (
    lastError ??
    new Error(
      "No readable JSON path",
    )
  );
}

async function verifierFixturePaths(
  config,
) {
  if (
    config.verifierManifestPath &&
    config.verifierContextPath
  ) {
    return {
      manifestPath:
        config.verifierManifestPath,
      contextPath:
        config.verifierContextPath,
    };
  }

  try {
    return {
      manifestPath:
        await latestResult(
          "ADMISSARY_R8_VALID_MANIFEST_",
        ),
      contextPath:
        await latestResult(
          "ADMISSARY_R8_DEPLOYMENT_CONTEXT_",
        ),
    };
  } catch {
    return {
      manifestPath:
        "deploy/seed/verifier-manifest.json",
      contextPath:
        "deploy/seed/deployment-context.json",
    };
  }
}

async function verifierScenario(
  scenario,
  config,
) {
  const {
    manifestPath,
    contextPath,
  } =
    await verifierFixturePaths(
      config,
    );

  const manifest =
    JSON.parse(
      await readFile(
        manifestPath,
        "utf8",
      ),
    );

  const context =
    parseDeploymentVerificationContext(
      JSON.parse(
        await readFile(
          contextPath,
          "utf8",
        ),
      ),
    );

  let candidateManifest =
    manifest;
  let candidateContext =
    context;

  if (
    scenario === "revision"
  ) {
    candidateContext =
      structuredClone(context);

    candidateContext.candidate.revision =
      "changed-revision-for-judge-demo";
  } else if (
    scenario === "stale"
  ) {
    candidateManifest =
      buildQualificationManifest({
        schema:
          "qualification-manifest/v1",
        candidate:
          manifest.candidate,
        contract:
          manifest.contract,
        policyPack:
          manifest.policyPack,
        evaluation:
          manifest.evaluation,
        evidenceGraph:
          manifest.evidenceGraph,
        qualification:
          manifest.qualification,
        authorization:
          manifest.authorization,
        validity: {
          state: "STALE",
        },
      });
  } else if (
    scenario === "unapproved"
  ) {
    candidateManifest =
      buildQualificationManifest({
        schema:
          "qualification-manifest/v1",
        candidate:
          manifest.candidate,
        contract:
          manifest.contract,
        policyPack:
          manifest.policyPack,
        evaluation:
          manifest.evaluation,
        evidenceGraph:
          manifest.evidenceGraph,
        qualification:
          manifest.qualification,
        authorization: {
          state: "PENDING",
        },
        validity:
          manifest.validity,
      });
  } else if (
    scenario === "contract"
  ) {
    candidateContext =
      structuredClone(context);

    candidateContext.contract.digest =
      "changed-contract-for-judge-demo";
  } else if (
    scenario !== "valid"
  ) {
    throw new Error(
      `Unknown verifier scenario: ${scenario}`,
    );
  }

  return {
    scenario,
    authorityScope: "HISTORICAL_PROOF_ONLY",
    currentAuthority: "NOT_EVALUATED",
    result:
      verifyDeploymentManifest(
        candidateManifest,
        candidateContext,
      ),
  };
}

async function readJudgeSnapshot(
  config,
) {
  const paths = config.snapshotPath ? [config.snapshotPath] : ["web/demo-snapshot.json", "deploy/seed/demo-snapshot.json"];

  const {
    path,
    value,
  } =
    await firstReadableJson(
      paths,
    );

  if (
    value.schema !==
    "admissary-judge-view/v1"
  ) {
    throw new Error(
      `Judge snapshot schema mismatch at ${path}`,
    );
  }

  const { snapshotDigest, ...payload } = value;
  if (digestCanonicalJson(payload) !== snapshotDigest) throw new Error("JUDGE_SNAPSHOT_INTEGRITY_FAILURE");
  const seed = JSON.parse(await readFile(config.snapshotSeedPath, "utf8"));
  const { seedDigest, ...seedPayload } = seed;
  if (digestCanonicalJson(seedPayload) !== seedDigest || seed.judgeSnapshot.snapshotDigest !== snapshotDigest) throw new Error("JUDGE_SNAPSHOT_SEED_BINDING_FAILURE");
  const binding = seed.files.find(x => x.name === "demo-snapshot.json");
  if (!binding || sha256Hex(await readFile(path)) !== binding.sha256) throw new Error("JUDGE_SNAPSHOT_FILE_BINDING_FAILURE");
  return { path, snapshot: value };
}


async function readJsonBody(
  req,
  {
    maxBytes = 64 * 1024,
  } = {},
) {
  const contentType =
    req.headers[
      "content-type"
    ];

  if (
    typeof contentType !==
      "string" ||
    !contentType
      .toLowerCase()
      .startsWith(
        "application/json",
      )
  ) {
    const error =
      new Error(
        "Content-Type must be application/json",
      );

    error.code =
      "UNSUPPORTED_MEDIA_TYPE";

    throw error;
  }

  let size = 0;
  const chunks = [];

  for await (
    const chunk of req
  ) {
    const buffer =
      Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk);

    size +=
      buffer.length;

    if (
      size > maxBytes
    ) {
      const error =
        new Error(
          "Request body exceeds maximum size",
        );

      error.code =
        "REQUEST_BODY_TOO_LARGE";

      throw error;
    }

    chunks.push(
      buffer,
    );
  }

  if (
    chunks.length === 0
  ) {
    const error =
      new Error(
        "Request body is required",
      );

    error.code =
      "INVALID_JSON_BODY";

    throw error;
  }

  try {
    return JSON.parse(
      Buffer.concat(
        chunks,
      ).toString(
        "utf8",
      ),
    );
  } catch {
    const error =
      new Error(
        "Request body must contain valid JSON",
      );

    error.code =
      "INVALID_JSON_BODY";

    throw error;
  }
}

async function serveStatic(
  pathname,
  res,
  responseOptions,
) {
  const relative =
    pathname === "/"
      ? "index.html"
      : pathname.slice(1);

  const safe =
    normalize(relative)
      .replace(
        /^([.][.][/\\])+/,
        "",
      );

  const root =
    normalize("web");

  const filePath =
    join(root, safe);

  if (
    !filePath.startsWith(root)
  ) {
    text(
      res,
      403,
      "Forbidden",
      responseOptions,
    );

    return 403;
  }

  try {
    const body =
      await readFile(
        filePath,
      );

    text(
      res,
      200,
      body,
      {
        ...responseOptions,
        contentType:
          MIME[
            extname(filePath)
          ] ??
          "application/octet-stream",
      },
    );

    return 200;
  } catch (error) {
    if (
      error &&
      typeof error ===
        "object" &&
      "code" in error &&
      error.code ===
        "ENOENT"
    ) {
      text(
        res,
        404,
        "Not found",
        responseOptions,
      );

      return 404;
    }

    throw error;
  }
}


function productRoleAllowed(
  role,
  capability = "READ",
) {
  if (capability === "ADMIN") {
    return role === "ADMIN";
  }

  if (capability === "APPROVE") {
    return (
      role === "APPROVER" ||
      role === "ADMIN"
    );
  }

  if (capability === "OPERATE") {
    return (
      role === "OPERATOR" ||
      role === "ADMIN"
    );
  }

  return (
    role === "VIEWER" ||
    role === "OPERATOR" ||
    role === "APPROVER" ||
    role === "ADMIN"
  );
}

async function productOverview(
  config,
  productService,
) {
  const registry =
    JSON.parse(
      await readFile(
        config.productRegistryProofPath,
        "utf8",
      ),
    );

  verifyProof(registry, "proofDigest", "admissary-r10c-registry-proof/v1");
  let assurance =
    null;

  try {
    assurance =
      JSON.parse(
        await readFile(
          config.productAssuranceProofPath,
          "utf8",
        ),
      );
  } catch (error) {
    if (
      !(
        error &&
        typeof error ===
          "object" &&
        "code" in error &&
        error.code ===
          "ENOENT"
      )
    ) {
      throw error;
    }
  }

  const deepSeek =
    registry.deployments.find(
      (item) =>
        item.deploymentId ===
        "deployment-deepseek-banking-prod",
    );

  const applicationState =
    await productService.state();

  if (assurance) verifyProof(assurance, "proofDigest", "admissary-r10c3-continuous-assurance-proof/v1");
  return {
    schema:
      "admissary-product-overview/v1",
    registry: {
      organizations:
        registry.counts.organizations,
      environments:
        registry.counts.environments,
      workloads:
        registry.counts.workloads,
      candidates:
        registry.counts.candidates,
      deployments:
        registry.counts.deployments,
    },
    applicationState: {
      candidates:
        applicationState.candidates.length,
      contracts:
        applicationState.contracts.length,
      qualificationRuns:
        applicationState.qualificationRuns.length,
      deployments:
        applicationState.deployments.length,
      attestations:
        applicationState.attestations.length,
    },
    realCandidateTruth: {
      model:
        deepSeek?.candidate ??
        "DeepSeek V4.1 Flash",
      empiricalFitness:
        "UNFIT",
      overallQualification:
        deepSeek
          ?.qualificationState ??
        "REVIEW_REQUIRED",
      deployAllowed:
        false,
    },
    liveCandidateExecutions: (await liveCandidateRecords()).map(r=>({candidateId:r.target.candidateId,model:r.target.model,provenance:r.partial?.provenance??'REAL_DOLPHIN_EXECUTION',completionStatus:r.summary.completionStatus,casesCompleted:r.summary.casesCompleted,expectedCaseCount:144,empiricalFitness:r.empiricalFitness,fullQualification:r.qualificationState,exactArtifactBindingProven:false,deployAllowed:false})),
    continuousAssurance: {
      available:
        assurance !== null,
      caseBInitialAllowed:
        assurance
          ?.caseB
          ?.initialAllowed ??
        null,
      caseBDriftAllowed:
        assurance
          ?.caseB
          ?.driftAllowed ??
        null,
      historicalApprovalPreserved:
        assurance
          ?.caseB
          ?.preservedHistoricalApprovalState ===
          "APPROVED"
          ? true
          : assurance === null
            ? null
            : false,
    },
    capabilities: {
      registry: true,
      workloadPacks: true,
      signedAttestations: true,
      ciAdmission: true,
      continuousAssurance: true,
      candidateSelection: true,
      guidanceMapping: true,
      lifecycleWriteApi: true,
    },
  };
}


async function readScenarioSnapshot(
  config,
) {
  const portfolio =
    JSON.parse(
      await readFile(
        config.scenarioSnapshotPath,
        "utf8",
      ),
    );

  if (
    portfolio?.schema !==
    "admissary-canonical-case-portfolio/v1"
  ) {
    throw new Error(
      "R10D_SCENARIO_SNAPSHOT_SCHEMA_ERROR",
    );
  }

  const {
    portfolioDigest,
    ...payload
  } = portfolio;

  if (
    digestCanonicalJson(
      payload,
    ) !== portfolioDigest
  ) {
    throw new Error(
      "R10D_SCENARIO_SNAPSHOT_DIGEST_ERROR",
    );
  }

  return portfolio;
}

export function createAdmissaryWebServer(
  options = {},
) {
  const config = {
    mode:
      options.mode ??
      "judge-demo",
    snapshotPath:
      options.snapshotPath,
    snapshotSeedPath: options.snapshotSeedPath ?? "deploy/seed/SEED_MANIFEST.json",
    verifierManifestPath:
      options.verifierManifestPath,
    verifierContextPath:
      options.verifierContextPath,
    secureTransport:
      options.secureTransport ??
      false,
    authTokens:
      options.authTokens ??
      {},
    attestationTrustStore:
      options.attestationTrustStore ??
      {},
    productRegistryProofPath:
      options.productRegistryProofPath ??
      "results/ADMISSARY_R10C_REGISTRY_PROOF.json",
    productAssuranceProofPath:
      options.productAssuranceProofPath ??
      "results/ADMISSARY_R10C3_CONTINUOUS_ASSURANCE_PROOF.json",
    productStatePath:
      options.productStatePath ??
      "results/ADMISSARY_R10C5_PRODUCT_STATE.json",
    productAssuranceStatePath:
      options.productAssuranceStatePath ??
      "results/ADMISSARY_R10C5_ASSURANCE_STATE.json",
    scenarioSnapshotPath:
      options.scenarioSnapshotPath ??
      "web/scenario-snapshot.json",
    auditFile:
      options.auditFile ??
      null,
    rateLimit:
      options.rateLimit ??
      DEFAULT_RATE_LIMIT,
  };

  const limiter =
    new FixedWindowRateLimiter(
      config.rateLimit,
    );

  const productRepository =
    options.productRepository ?? new JsonProductRepository(
      config.productStatePath,
    );

  const productAssuranceRepository =
    options.productAssuranceRepository ?? new JsonAssuranceRepository(
      config.productAssuranceStatePath,
    );

  const productService =
    new ProductApplicationService(
      productRepository,
      new ContinuousAssuranceService(
        productAssuranceRepository,
      ),
      options.completionEvidenceResolver ?? acceptedRealEvidence,
      config.attestationTrustStore,
    );

  const server =
    createServer(
      async (
        req,
        res,
      ) => {
        const started =
          Date.now();

        const requestId =
          randomUUID();

        let status = 500;
        let actorRole =
          "PUBLIC";
        let event =
          "REQUEST";

        let url, pathname;
        try {
          url = new URL(req.url ?? "/", "http://127.0.0.1");
          // Decode once for both routing and resource limiting. Bad encodings reject.
          pathname = decodeURIComponent(url.pathname);
        } catch {
          json(res, 400, { error: "INVALID_REQUEST_TARGET", requestId }, { requestId });
          return;
        }
        const rate = limiter.consume(`${clientIp(req)}:${pathname}`);
        const responseOptions = { requestId, secureTransport: config.secureTransport, rateLimit: rate };

        try {
          if (rate.blocked) {
            status = 429;
            event =
              "RATE_LIMITED";

            json(
              res,
              status,
              {
                error:
                  "RATE_LIMITED",
                requestId,
              },
              responseOptions,
            );

            return;
          }

          if (
            pathname ===
              "/v1/product/judge-view" &&
            req.method ===
              "GET"
          ) {
            const {
              snapshot,
            } =
              await readJudgeSnapshot(
                config,
              );

            status = 200;
            event =
              "PRODUCT_PUBLIC_JUDGE_VIEW";

            json(
              res,
              status,
              snapshot,
              responseOptions,
            );

            return;
          }

          if (
            pathname ===
              "/v1/product/verifier-demo" &&
            req.method ===
              "GET"
          ) {
            const scenario =
              url.searchParams.get(
                "scenario",
              ) ?? "valid";

            status = 200;
            event =
              "PRODUCT_PUBLIC_VERIFIER_DEMO";

            json(
              res,
              status,
              await verifierScenario(
                scenario,
                config,
              ),
              responseOptions,
            );

            return;
          }

          if (
            pathname ===
              "/v1/product/scenarios" &&
            req.method ===
              "GET"
          ) {
            status = 200;
            event =
              "PRODUCT_PUBLIC_CANONICAL_CASES";

            json(
              res,
              status,
              {
                schema:
                  "admissary-product-canonical-cases-response/v1",
                portfolio:
                  await readScenarioSnapshot(
                    config,
                  ),
                requestId,
              },
              responseOptions,
            );

            return;
          }

          if (pathname === "/v1/admission/check") {
            status=410;
            json(res,status,{error:"HISTORICAL_ROUTE_RENAMED",historicalProof:"/v1/proofs/verify",currentAdmission:"/v1/product/deployments/:id/admission",requestId},responseOptions);
            return;
          }

          const currentAdmissionMatch =
            req.method === "POST"
              ? /^\/v1\/product\/deployments\/([^/]+)\/admission$/.exec(
                  pathname,
                )
              : null;

          if (currentAdmissionMatch) {
            const token =
              parseBearerToken(req);

            const role =
              roleForToken(
                token,
                config.authTokens,
              );

            if (!role) {
              status = 401;
              event =
                "CURRENT_ADMISSION_AUTHENTICATION_DENIED";

              json(
                res,
                status,
                {
                  error:
                    "UNAUTHENTICATED",
                  requestId,
                },
                responseOptions,
              );

              return;
            }

            actorRole = role;

            if (
              role !== "ADMISSION" &&
              role !== "ADMIN"
            ) {
              status = 403;
              event =
                "CURRENT_ADMISSION_AUTHORIZATION_DENIED";

              json(
                res,
                status,
                {
                  error:
                    "FORBIDDEN",
                  requestId,
                },
                responseOptions,
              );

              return;
            }

            let body;

            try {
              body =
                await readJsonBody(
                  req,
                );
            } catch (error) {
              status = 400;
              event =
                "CURRENT_ADMISSION_REQUEST_REJECTED";

              json(
                res,
                status,
                {
                  error:
                    error?.code ??
                    "INVALID_REQUEST",
                  requestId,
                },
                responseOptions,
              );

              return;
            }

            if (
              body?.schema !==
                "admissary-current-deployment-admission-request/v1" ||
              !body.context
            ) {
              status = 400;
              event =
                "CURRENT_ADMISSION_REQUEST_REJECTED";

              json(
                res,
                status,
                {
                  error:
                    "CURRENT_ADMISSION_BODY_SCHEMA_ERROR",
                  requestId,
                },
                responseOptions,
              );

              return;
            }

            const deploymentId =
              currentAdmissionMatch[1];

            try {
              const result = await productService.admitCurrentDeployment(deploymentId, body.context, nowIso());
              status = result.allowed ? 200 : 409;
              event = result.allowed ? "CURRENT_ADMISSION_ALLOWED" : "CURRENT_ADMISSION_DENIED";
              json(res, status, { ...result, requestId }, responseOptions);
              return;
            } catch (error) {
              status =
                error?.code?.includes?.(
                  "NOT_FOUND",
                )
                  ? 404
                  : 400;

              event =
                "CURRENT_ADMISSION_REQUEST_REJECTED";

              json(
                res,
                status,
                {
                  error:
                    error?.code ??
                    "CURRENT_ADMISSION_INVALID",
                  detail:
                    error instanceof Error
                      ? error.message
                      : String(error),
                  requestId,
                },
                responseOptions,
              );

              return;
            }
          }

          if (
            pathname ===
              "/v1/product/selection" &&
            req.method ===
              "POST"
          ) {
            const token =
              parseBearerToken(req);

            const role =
              roleForToken(
                token,
                config.authTokens,
              );

            if (!role) {
              status = 401;
              event =
                "PRODUCT_AUTHENTICATION_DENIED";

              json(
                res,
                status,
                {
                  error:
                    "UNAUTHENTICATED",
                  requestId,
                },
                responseOptions,
              );

              return;
            }

            actorRole =
              role;

            if (
              !productRoleAllowed(
                role,
                "OPERATE",
              )
            ) {
              status = 403;
              event =
                "PRODUCT_AUTHORIZATION_DENIED";

              json(
                res,
                status,
                {
                  error:
                    "FORBIDDEN",
                  requestId,
                },
                responseOptions,
              );

              return;
            }

            let body;

            try {
              body =
                await readJsonBody(
                  req,
                );
            } catch (error) {
              status = 400;
              event =
                "PRODUCT_SELECTION_REJECTED";

              json(
                res,
                status,
                {
                  error:
                    error?.code ??
                    "INVALID_REQUEST",
                  requestId,
                },
                responseOptions,
              );

              return;
            }

            if (
              body?.schema !==
              "admissary-product-selection-request/v1" ||
              !Array.isArray(
                body.candidateIds,
              ) ||
              !body.policy || Object.keys(body).sort().join(",") !== "candidateIds,policy,schema"
            ) {
              status = 400;
              event =
                "PRODUCT_SELECTION_REJECTED";

              json(
                res,
                status,
                {
                  error:
                    "PRODUCT_SELECTION_SCHEMA_ERROR",
                  requestId,
                },
                responseOptions,
              );

              return;
            }

            let result;

            try {
              result =
                await productService.select(body.candidateIds, body.policy);
            } catch (error) {
              status = 400;
              event =
                "PRODUCT_SELECTION_REJECTED";

              json(
                res,
                status,
                {
                  error:
                    "PRODUCT_SELECTION_INVALID",
                  detail:
                    error instanceof Error
                      ? error.message
                      : String(error),
                  requestId,
                },
                responseOptions,
              );

              return;
            }

            status = 200;
            event =
              "PRODUCT_SELECTION_COMPLETED";

            json(
              res,
              status,
              {
                schema:
                  "admissary-product-selection-response/v1",
                result,
                requestId,
              },
              responseOptions,
            );

            return;
          }

          if (
            req.method === "POST" &&
            (
              pathname === "/v1/product/candidates" ||
              pathname === "/v1/product/contracts" ||
              pathname === "/v1/product/qualifications" ||
              pathname === "/v1/product/deployments" ||
              /^\/v1\/product\/qualifications\/[^/]+\/complete$/.test(pathname) ||
              /^\/v1\/product\/deployments\/[^/]+\/(approve|revoke|requalification|attestation|material-change|complete-reassessment)$/.test(pathname)
            )
          ) {
            const token = parseBearerToken(req);
            const role = roleForToken(token, config.authTokens);

            if (!role) {
              status = 401;
              event = "PRODUCT_AUTHENTICATION_DENIED";
              json(res, status, { error: "UNAUTHENTICATED", requestId }, responseOptions);
              return;
            }

            actorRole = role;

            let capability = "OPERATE";
            if (/\/approve$/.test(pathname) || /\/revoke$/.test(pathname)) {
              capability = "APPROVE";
            } else if (/\/complete$/.test(pathname) || /\/attestation$/.test(pathname) || /\/(material-change|complete-reassessment)$/.test(pathname)) {
              capability = "ADMIN";
            }

            if (!productRoleAllowed(role, capability)) {
              status = 403;
              event = "PRODUCT_AUTHORIZATION_DENIED";
              json(res, status, { error: "FORBIDDEN", requestId }, responseOptions);
              return;
            }

            let body;
            try {
              body = await readJsonBody(req);
            } catch (error) {
              status = 400;
              event = "PRODUCT_REQUEST_REJECTED";
              json(res, status, { error: error?.code ?? "INVALID_REQUEST", requestId }, responseOptions);
              return;
            }

            try {
              if (pathname === "/v1/product/candidates") {
                if (body?.schema !== "admissary-product-register-candidate/v1") {
                  throw new Error("PRODUCT_CANDIDATE_SCHEMA_ERROR");
                }
                const result = await productService.registerCandidate({
                  candidateId: body.candidateId,
                  displayName: body.displayName,
                  provider: body.provider,
                  repositoryOrModelId: body.repositoryOrModelId,
                  revision: body.revision ?? null,
                  tokenizerRevision: body.tokenizerRevision ?? null,
                  artifactManifestDigest: body.artifactManifestDigest ?? null,
                  actorId: role,
                  occurredAt: body.occurredAt,
                });
                status = result.created ? 201 : 200;
                event = result.created ? "PRODUCT_CANDIDATE_REGISTERED" : "PRODUCT_CANDIDATE_IDEMPOTENT";
                json(res, status, {
                  schema: "admissary-product-register-candidate-response/v1",
                  ...result,
                  requestId,
                }, responseOptions);
                return;
              }

              if (pathname === "/v1/product/contracts") {
                if (body?.schema !== "admissary-product-register-contract/v1") {
                  throw new Error("PRODUCT_CONTRACT_SCHEMA_ERROR");
                }
                const result = await productService.registerContract({
                  contractId: body.contractId,
                  version: body.version,
                  digest: body.digest,
                  workloadId: body.workloadId,
                  environmentId: body.environmentId,
                  actorId: role,
                  occurredAt: body.occurredAt,
                });
                status = result.created ? 201 : 200;
                event = result.created ? "PRODUCT_CONTRACT_REGISTERED" : "PRODUCT_CONTRACT_IDEMPOTENT";
                json(res, status, {
                  schema: "admissary-product-register-contract-response/v1",
                  ...result,
                  requestId,
                }, responseOptions);
                return;
              }

              if (pathname === "/v1/product/qualifications") {
                if (body?.schema !== "admissary-product-start-qualification/v1") {
                  throw new Error("PRODUCT_QUALIFICATION_SCHEMA_ERROR");
                }
                const run = await productService.startQualification({
                  candidateId: body.candidateId,
                  contractId: body.contractId,
                  contractVersion: body.contractVersion,
                  actorId: role,
                  requestedAt: body.requestedAt,
                  reason: body.reason,
                  replacesDeploymentId: body.replacesDeploymentId ?? null,
                });
                status = 202;
                event = "PRODUCT_QUALIFICATION_REQUESTED";
                json(res, status, {
                  schema: "admissary-product-qualification-response/v1",
                  run,
                  providerCalls: 0,
                  executionStatus: "REQUESTED_NOT_RUN",
                  requestId,
                }, responseOptions);
                return;
              }

              const completeMatch = /^\/v1\/product\/qualifications\/([^/]+)\/complete$/.exec(pathname);
              if (completeMatch) {
                if (body?.schema !== "admissary-product-complete-qualification/v1") {
                  throw new Error("PRODUCT_QUALIFICATION_COMPLETION_SCHEMA_ERROR");
                }
                const run = await productService.completeQualification({
                  runId: completeMatch[1],
                  qualificationState: body.qualificationState,
                  blockers: body.blockers ?? [],
                  exactArtifactBindingProven: body.exactArtifactBindingProven === true,
                  evidenceGraphRootDigest: body.evidenceGraphRootDigest,
                  policyVersion: body.policyVersion ?? null,
                  policyDigest: body.policyDigest ?? null,
                  evaluationSuite: body.evaluationSuite ?? null,
                  evaluationDigest: body.evaluationDigest ?? null,
                  sourceRefs: body.sourceRefs ?? [],
                  actorId: role,
                  completedAt: body.completedAt,
                });
                status = 200;
                event = "PRODUCT_QUALIFICATION_COMPLETED";
                json(res, status, {
                  schema: "admissary-product-qualification-response/v1",
                  run,
                  requestId,
                }, responseOptions);
                return;
              }

              if (pathname === "/v1/product/deployments") {
                if (body?.schema !== "admissary-product-create-deployment/v1") {
                  throw new Error("PRODUCT_DEPLOYMENT_SCHEMA_ERROR");
                }
                const deployment = await productService.createDeployment({
                  deploymentId: body.deploymentId,
                  runId: body.runId,
                  actorId: role,
                  createdAt: body.createdAt,
                  maxEvidenceAgeMs: body.maxEvidenceAgeMs,
                });
                status = 201;
                event = "PRODUCT_DEPLOYMENT_CREATED";
                json(res, status, {
                  schema: "admissary-product-deployment-response/v1",
                  deployment,
                  requestId,
                }, responseOptions);
                return;
              }

              const deploymentAction = /^\/v1\/product\/deployments\/([^/]+)\/(approve|revoke|requalification|attestation|material-change|complete-reassessment)$/.exec(pathname);
              if (deploymentAction) {
                const deploymentId = deploymentAction[1];
                const action = deploymentAction[2];

                if (action === "material-change") {
                  if (body?.schema !== "admissary-product-material-change/v1") throw new Error("PRODUCT_MATERIAL_CHANGE_SCHEMA_ERROR");
                  const result=await productService.recordMaterialChange({deploymentId,actorId:role,checkedAt:body.checkedAt,comparison:body.comparison,nextIdentity:body.nextIdentity,reason:body.reason});
                  status=200;event="PRODUCT_MATERIAL_CHANGE_RECORDED";json(res,status,{schema:"admissary-product-material-change-response/v1",...result,requestId},responseOptions);return;
                }
                if (action === "complete-reassessment") {
                  if (body?.schema !== "admissary-product-complete-reassessment/v1") throw new Error("PRODUCT_REASSESSMENT_COMPLETION_SCHEMA_ERROR");
                  const view=await productService.completeReassessment({deploymentId,requestId:body.requestId,replacementQualificationRunId:body.replacementQualificationRunId,actorId:role,completedAt:body.completedAt});
                  status=200;event="PRODUCT_REASSESSMENT_COMPLETED";json(res,status,{schema:"admissary-product-deployment-view-response/v1",view,requestId},responseOptions);return;
                }

                if (action === "approve") {
                  if (body?.schema !== "admissary-product-approval-request/v1") {
                    throw new Error("PRODUCT_APPROVAL_SCHEMA_ERROR");
                  }
                  const approval = await productService.approveDeployment({
                    deploymentId,
                    actorId: role,
                    issuedAt: body.issuedAt,
                    expiresAt: body.expiresAt ?? null,
                    reason: body.reason,
                  });
                  status = 200;
                  event = "PRODUCT_DEPLOYMENT_APPROVED";
                  json(res, status, { schema: "admissary-product-approval-response/v1", approval, requestId }, responseOptions);
                  return;
                }

                if (action === "revoke") {
                  if (body?.schema !== "admissary-product-revocation-request/v1") {
                    throw new Error("PRODUCT_REVOCATION_SCHEMA_ERROR");
                  }
                  const approval = await productService.revokeDeployment({
                    deploymentId,
                    actorId: role,
                    occurredAt: body.occurredAt,
                    reason: body.reason,
                  });
                  status = 200;
                  event = "PRODUCT_DEPLOYMENT_REVOKED";
                  json(res, status, { schema: "admissary-product-revocation-response/v1", approval, requestId }, responseOptions);
                  return;
                }

                if (action === "requalification") {
                  if (body?.schema !== "admissary-product-requalification-request/v1") {
                    throw new Error("PRODUCT_REQUALIFICATION_SCHEMA_ERROR");
                  }
                  const run = await productService.requestRequalification({
                    deploymentId,
                    actorId: role,
                    requestedAt: body.requestedAt,
                    reason: body.reason,
                    ...(body.candidateId === undefined ? {} : {candidateId: body.candidateId}),
                  });
                  status = 202;
                  event = "PRODUCT_REQUALIFICATION_REQUESTED";
                  json(res, status, {
                    schema: "admissary-product-qualification-response/v1",
                    run,
                    providerCalls: 0,
                    executionStatus: "REQUESTED_NOT_RUN",
                    requestId,
                  }, responseOptions);
                  return;
                }

                if (action === "attestation") {
                  if (body?.schema !== "admissary-product-record-attestation/v1") {
                    throw new Error("PRODUCT_ATTESTATION_SCHEMA_ERROR");
                  }
                  const verification = verifySignedQualificationAttestation(
                    body.attestation,
                    config.attestationTrustStore,
                  );
                  if (!verification.valid) {
                    status = 409;
                    event = "PRODUCT_ATTESTATION_REJECTED";
                    json(res, status, {
                      error: "ATTESTATION_INVALID",
                      reasons: verification.reasons,
                      requestId,
                    }, responseOptions);
                    return;
                  }
                  const record = await productService.recordAttestation({
                    deploymentId,
                    attestation: body.attestation,
                    actorId: role,
                    recordedAt: body.recordedAt,
                  });
                  status = 201;
                  event = "PRODUCT_ATTESTATION_RECORDED";
                  json(res, status, {
                    schema: "admissary-product-attestation-response/v1",
                    record,
                    requestId,
                  }, responseOptions);
                  return;
                }
              }
            } catch (error) {
              status = error?.code?.includes?.("CONFLICT") ? 409 : 400;
              event = "PRODUCT_REQUEST_REJECTED";
              json(res, status, {
                error: error?.code ?? "PRODUCT_REQUEST_INVALID",
                detail: error instanceof Error ? error.message : String(error),
                requestId,
              }, responseOptions);
              return;
            }
          }

          if (
            pathname ===
              "/v1/proofs/verify" &&
            req.method ===
              "POST"
          ) {
            const token =
              parseBearerToken(req);

            const role =
              roleForToken(
                token,
                config.authTokens,
              );

            if (!role) {
              status = 401;
              event =
                "ADMISSION_AUTHENTICATION_DENIED";

              json(
                res,
                status,
                {
                  error:
                    "UNAUTHENTICATED",
                  requestId,
                },
                {
                  ...responseOptions,
                  extraHeaders: {
                    "www-authenticate":
                      'Bearer realm="Admissary historical proof verification"',
                  },
                },
              );

              return;
            }

            actorRole =
              role;

            if (
              role !==
                "ADMISSION" &&
              role !==
                "ADMIN"
            ) {
              status = 403;
              event =
                "ADMISSION_AUTHORIZATION_DENIED";

              json(
                res,
                status,
                {
                  error:
                    "FORBIDDEN",
                  requestId,
                },
                responseOptions,
              );

              return;
            }

            let body;

            try {
              body =
                await readJsonBody(
                  req,
                );
            } catch (error) {
              const code =
                error?.code;

              if (
                code ===
                "UNSUPPORTED_MEDIA_TYPE"
              ) {
                status = 415;
              } else if (
                code ===
                "REQUEST_BODY_TOO_LARGE"
              ) {
                status = 413;
              } else {
                status = 400;
              }

              event =
                "ADMISSION_REQUEST_REJECTED";

              json(
                res,
                status,
                {
                  error:
                    code ??
                    "INVALID_REQUEST",
                  requestId,
                },
                responseOptions,
              );

              return;
            }

            const keys =
              body &&
              typeof body ===
                "object" &&
              !Array.isArray(body)
                ? Object.keys(
                    body,
                  ).sort()
                : [];

            if (
              JSON.stringify(
                keys,
              ) !==
              JSON.stringify(
                [
                  "attestation",
                  "context",
                  "operationalScope",
                ],
              )
            ) {
              status = 400;
              event =
                "ADMISSION_REQUEST_REJECTED";

              json(
                res,
                status,
                {
                  error:
                    "ADMISSION_BODY_SCHEMA_ERROR",
                  requestId,
                },
                responseOptions,
              );

              return;
            }

            let admission;

            try {
              admission =
                verifyHistoricalAttestationProof({
                  operationalScope: body.operationalScope,
                  attestation:
                    body.attestation,
                  currentContext:
                    body.context,
                  trustStore:
                    config.attestationTrustStore,
                });
            } catch (error) {
              status = 400;
              event =
                "ADMISSION_REQUEST_REJECTED";

              json(
                res,
                status,
                {
                  error:
                    "ADMISSION_VERIFICATION_INPUT_ERROR",
                  detail:
                    error instanceof Error
                      ? error.message
                      : String(error),
                  requestId,
                },
                responseOptions,
              );

              return;
            }

            status =
              admission.allowed
                ? 200
                : 409;

            event =
              admission.allowed
                ? "HISTORICAL_PROOF_VALID"
                : "HISTORICAL_PROOF_INVALID";

            json(
              res,
              status,
              {
                schema: "admissary-historical-proof-verification/v1",
                valid: admission.allowed,
                proofStatus: admission.allowed ? "VALID" : "INVALID",
                currentAuthority: "NOT_EVALUATED",
                attestation:
                  admission.attestation,
                verification:
                  admission.deploymentVerification,
                requestId,
              },
              responseOptions,
            );

            return;
          }

          if (
            req.method !==
            "GET"
          ) {
            status = 405;

            json(
              res,
              status,
              {
                error:
                  "METHOD_NOT_ALLOWED",
                requestId,
              },
              {
                ...responseOptions,
                extraHeaders: {
                  allow: "GET",
                },
              },
            );

            return;
          }

          if (
            pathname ===
            "/health"
          ) {
            await options.persistenceCheck?.();
            status = 200;

            json(
              res,
              status,
              {
                status: "ok",
                product:
                  "Admissary",
                mode:
                  config.mode,
                providerCalls: 0,
                requestId,
              },
              responseOptions,
            );

            return;
          }

          if (
            pathname ===
            "/ready"
          ) {
            await options.persistenceCheck?.();
            const {
              snapshot,
            } =
              await readJudgeSnapshot(
                config,
              );

            status = 200;

            json(
              res,
              status,
              {
                status:
                  "ready",
                snapshotDigest:
                  snapshot.snapshotDigest,
                requestId,
              },
              responseOptions,
            );

            return;
          }

          if (
            pathname ===
            "/api/judge"
          ) {
            const {
              snapshot,
            } =
              await readJudgeSnapshot(
                config,
              );

            status = 200;

            json(
              res,
              status,
              snapshot,
              responseOptions,
            );

            return;
          }

          if (
            pathname ===
            "/api/verify-demo"
          ) {
            const scenario =
              url.searchParams.get(
                "scenario",
              ) ??
              "valid";

            status = 200;

            json(
              res,
              status,
              await verifierScenario(
                scenario,
                config,
              ),
              responseOptions,
            );

            return;
          }

          if (
            req.method === "GET" &&
            (
              pathname === "/v1/product/candidates" ||
              pathname === "/v1/product/contracts" ||
              pathname === "/v1/product/deployments" ||
              /^\/v1\/product\/qualifications\/[^/]+(\/blockers)?$/.test(pathname) ||
              /^\/v1\/product\/deployments\/[^/]+(\/attestation|\/audit|\/rollback-targets)?$/.test(pathname)
            )
          ) {
            const token = parseBearerToken(req);
            const role = roleForToken(token, config.authTokens);

            if (!role) {
              status = 401;
              event = "PRODUCT_AUTHENTICATION_DENIED";
              json(res, status, { error: "UNAUTHENTICATED", requestId }, responseOptions);
              return;
            }

            actorRole = role;
            if (!productRoleAllowed(role, "READ")) {
              status = 403;
              event = "PRODUCT_AUTHORIZATION_DENIED";
              json(res, status, { error: "FORBIDDEN", requestId }, responseOptions);
              return;
            }

            const now = url.searchParams.get("now") ?? nowIso();

            try {
              if (pathname === "/v1/product/candidates") {
                status = 200;
                event = "PRODUCT_CANDIDATES_READ";
                json(res, status, { schema: "admissary-product-candidate-list/v1", candidates: await productService.candidates(), requestId }, responseOptions);
                return;
              }

              if (pathname === "/v1/product/contracts") {
                status = 200;
                event = "PRODUCT_CONTRACTS_READ";
                json(res, status, { schema: "admissary-product-contract-list/v1", contracts: await productService.contracts(), requestId }, responseOptions);
                return;
              }

              if (pathname === "/v1/product/deployments") {
                const validity = url.searchParams.get("validity") ?? "ALL";
                if (!["ALL", "CURRENT", "STALE"].includes(validity)) {
                  throw new Error("PRODUCT_VALIDITY_FILTER_ERROR");
                }
                status = 200;
                event = "PRODUCT_DEPLOYMENTS_READ";
                json(res, status, { schema: "admissary-product-deployment-list-response/v1", deployments: await productService.deployments(now, validity), requestId }, responseOptions);
                return;
              }

              const qualificationMatch = /^\/v1\/product\/qualifications\/([^/]+)(\/blockers)?$/.exec(pathname);
              if (qualificationMatch) {
                const runId = qualificationMatch[1];
                if (qualificationMatch[2]) {
                  status = 200;
                  event = "PRODUCT_BLOCKERS_READ";
                  json(res, status, { schema: "admissary-product-blockers-response/v1", runId, blockers: await productService.blockers(runId), requestId }, responseOptions);
                } else {
                  status = 200;
                  event = "PRODUCT_QUALIFICATION_READ";
                  json(res, status, { schema: "admissary-product-qualification-response/v1", run: await productService.run(runId), requestId }, responseOptions);
                }
                return;
              }

              const deploymentMatch = /^\/v1\/product\/deployments\/([^/]+)(\/attestation|\/audit|\/rollback-targets)?$/.exec(pathname);
              if (deploymentMatch) {
                const deploymentId = deploymentMatch[1];
                const suffix = deploymentMatch[2] ?? "";

                if (suffix === "/attestation") {
                  status = 200;
                  event = "PRODUCT_ATTESTATION_READ";
                  json(res, status, {
                    schema: "admissary-product-attestation-response/v1",
                    record: await productService.getAttestation(deploymentId),
                    requestId,
                  }, responseOptions);
                  return;
                }

                if (suffix === "/audit") {
                  status = 200;
                  event = "PRODUCT_DEPLOYMENT_AUDIT_READ";
                  json(res, status, {
                    schema: "admissary-product-deployment-audit-response/v1",
                    audit: await productService.auditDeployment(deploymentId, now),
                    requestId,
                  }, responseOptions);
                  return;
                }

                if (suffix === "/rollback-targets") {
                  status = 200;
                  event = "PRODUCT_ROLLBACK_TARGETS_READ";
                  json(res, status, {
                    schema: "admissary-product-rollback-targets-response/v1",
                    deploymentId,
                    targets: await productService.rollbackTargets(deploymentId, now),
                    requestId,
                  }, responseOptions);
                  return;
                }

                status = 200;
                event = "PRODUCT_DEPLOYMENT_READ";
                json(res, status, {
                  schema: "admissary-product-deployment-view-response/v1",
                  view: await productService.deployment(deploymentId, now),
                  requestId,
                }, responseOptions);
                return;
              }
            } catch (error) {
              status = error?.code?.includes?.("NOT_FOUND") ? 404 : 400;
              event = "PRODUCT_READ_REJECTED";
              json(res, status, { error: error?.code ?? "PRODUCT_READ_INVALID", detail: error instanceof Error ? error.message : String(error), requestId }, responseOptions);
              return;
            }
          }

          if (
            pathname ===
            "/v1/product/overview" ||
            pathname ===
            "/v1/product/guidance"
          ) {
            const token =
              parseBearerToken(req);

            const role =
              roleForToken(
                token,
                config.authTokens,
              );

            if (!role) {
              status = 401;
              event =
                "PRODUCT_AUTHENTICATION_DENIED";

              json(
                res,
                status,
                {
                  error:
                    "UNAUTHENTICATED",
                  requestId,
                },
                responseOptions,
              );

              return;
            }

            actorRole =
              role;

            if (
              !productRoleAllowed(
                role,
                "READ",
              )
            ) {
              status = 403;
              event =
                "PRODUCT_AUTHORIZATION_DENIED";

              json(
                res,
                status,
                {
                  error:
                    "FORBIDDEN",
                  requestId,
                },
                responseOptions,
              );

              return;
            }

            if (
              pathname ===
              "/v1/product/overview"
            ) {
              status = 200;
              event =
                "PRODUCT_OVERVIEW_READ";

              json(
                res,
                status,
                await productOverview(
                  config,
                  productService,
                ),
                responseOptions,
              );

              return;
            }

            status = 200;
            event =
              "PRODUCT_GUIDANCE_READ";

            json(
              res,
              status,
              {
                schema:
                  "admissary-product-guidance-response/v1",
                mapping:
                  buildAdmissaryGuidanceMapping(),
                requestId,
              },
              responseOptions,
            );

            return;
          }

          if (
            pathname ===
            "/api/admin/status"
          ) {
            const token =
              parseBearerToken(req);

            const role =
              roleForToken(
                token,
                config.authTokens,
              );

            if (!role) {
              status = 401;
              event =
                "AUTHENTICATION_DENIED";

              json(
                res,
                status,
                {
                  error:
                    "UNAUTHENTICATED",
                  requestId,
                },
                {
                  ...responseOptions,
                  extraHeaders: {
                    "www-authenticate":
                      'Bearer realm="Admissary"',
                  },
                },
              );

              return;
            }

            actorRole =
              role;

            if (
              role !== "ADMIN"
            ) {
              status = 403;
              event =
                "AUTHORIZATION_DENIED";

              json(
                res,
                status,
                {
                  error:
                    "FORBIDDEN",
                  requestId,
                },
                responseOptions,
              );

              return;
            }

            status = 200;
            event =
              "ADMIN_STATUS_READ";

            json(
              res,
              status,
              {
                product:
                  "Admissary",
                mode:
                  config.mode,
                role,
                publicJudgeView:
                  true,
                providerCalls: 0,
                requestId,
              },
              responseOptions,
            );

            return;
          }

          status =
            await serveStatic(
              pathname,
              res,
              responseOptions,
            );
        } catch (error) {
          status = 500;
          event =
            "INTERNAL_ERROR";

          json(
            res,
            status,
            {
              error:
                "INTERNAL_ERROR",
              requestId,
            },
            responseOptions,
          );

          console.error(
            "ADMISSARY_SERVER_ERROR",
            error instanceof Error
              ? error.message
              : String(error),
          );
        } finally {
          await audit(
            {
              requestId,
              method:
                req.method ??
                "UNKNOWN",
              path:
                pathname,
              status,
              actorRole,
              remoteAddress:
                clientIp(req),
              durationMs:
                Date.now() -
                started,
              event,
            },
            config.auditFile,
          ).catch(error => console.error("ADMISSARY_AUDIT_WRITE_ERROR", error?.code ?? "IO_ERROR"));
        }
      },
    );

  server.requestTimeout =
    options.requestTimeoutMs ??
    15_000;

  server.headersTimeout =
    options.headersTimeoutMs ??
    10_000;

  server.keepAliveTimeout =
    options.keepAliveTimeoutMs ??
    5_000;

  server.maxHeadersCount =
    100;

  return server;
}

export {
  readJudgeSnapshot,
  FixedWindowRateLimiter,
};
