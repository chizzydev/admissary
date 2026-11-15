import test from "node:test";
import assert from "node:assert/strict";

import {
  HuggingFaceEvidenceCollector,
  assessRemoteCodeRequirement,
  classifyArtifactFile,
} from "../dist/index.js";

const SHA = "0123456789abcdef0123456789abcdef01234567";

function responseJson(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json",
      ...headers,
    },
  });
}

function responseText(value, status = 200, headers = {}) {
  return new Response(value, {
    status,
    headers,
  });
}

function fakeHubFetch() {
  const calls = [];

  const fetchImpl = async (url, init = {}) => {
    const value = String(url);
    const method = init.method ?? "GET";
    calls.push({ url: value, method });

    if (
      method === "GET" &&
      value.includes("/api/models/example/custom-model/revision/main")
    ) {
      return responseJson({
        id: "example/custom-model",
        sha: SHA,
        author: "example",
        gated: false,
        pipeline_tag: "text-generation",
        library_name: "transformers",
        cardData: {
          license: "apache-2.0",
        },
        tags: ["transformers", "safetensors"],
        safetensors: { total: 123 },
        siblings: [
          { rfilename: "README.md" },
          { rfilename: "LICENSE" },
          { rfilename: "config.json" },
          { rfilename: "model.safetensors" },
          { rfilename: "modeling_custom.py" },
        ],
      });
    }

    if (method === "HEAD" && value.includes(`/resolve/${SHA}/`)) {
      const path = decodeURIComponent(value.split(`/resolve/${SHA}/`)[1] ?? "");
      return new Response(null, {
        status: path === "model.safetensors" ? 302 : 200,
        headers: {
          "x-repo-commit": SHA,
          "etag": `"git-${path}"`,
          ...(path === "model.safetensors"
            ? {
                "x-linked-etag": '"sha256-weight"',
                "x-linked-size": "123",
                location: "https://cdn.example/model.safetensors",
              }
            : {
                "content-length": "100",
              }),
        },
      });
    }

    if (method === "GET" && value.endsWith(`/resolve/${SHA}/README.md`)) {
      return responseText("# Example model\nThis is a model card.");
    }

    if (method === "GET" && value.endsWith(`/resolve/${SHA}/LICENSE`)) {
      return responseText("Apache License Version 2.0");
    }

    if (method === "GET" && value.endsWith(`/resolve/${SHA}/config.json`)) {
      return responseText(JSON.stringify({
        model_type: "custom",
        auto_map: {
          AutoConfig: "configuration_custom.CustomConfig",
          AutoModelForCausalLM: "modeling_custom.CustomModel",
        },
      }));
    }

    throw new Error(`Unexpected fake fetch: ${method} ${value}`);
  };

  return { fetchImpl, calls };
}

test("artifact file classifier keeps executable model code distinct", () => {
  assert.equal(classifyArtifactFile("model.safetensors"), "WEIGHT");
  assert.equal(classifyArtifactFile("tokenizer.json"), "TOKENIZER");
  assert.equal(classifyArtifactFile("README.md"), "MODEL_CARD");
  assert.equal(classifyArtifactFile("LICENSE"), "LICENSE");
  assert.equal(classifyArtifactFile("config.json"), "CONFIG");
  assert.equal(classifyArtifactFile("modeling_custom.py"), "MODEL_CODE");
});

test("auto_map is treated as explicit custom-code loading evidence", () => {
  const result = assessRemoteCodeRequirement(
    {
      auto_map: {
        AutoModel: "modeling_custom.CustomModel",
      },
    },
    [],
  );

  assert.equal(result.state, "REQUIRED");
  assert.deepEqual(result.evidencePaths, ["config.json"]);
});

test("Python model files without auto_map are indicated, not falsely proven required", () => {
  const result = assessRemoteCodeRequirement(
    { model_type: "example" },
    [{
      path: "modeling_example.py",
      role: "MODEL_CODE",
      size: 100,
      etag: "x",
      storageIdentity: "x",
      repoCommit: SHA,
    }],
  );

  assert.equal(result.state, "INDICATED");
});

test("collector binds every fetched file to the immutable resolved revision", async () => {
  const { fetchImpl } = fakeHubFetch();
  const collector = new HuggingFaceEvidenceCollector({
    fetchImpl,
    now: () => new Date("2026-11-14T14:00:00.000Z"),
  });

  const bundle = await collector.collect("example/custom-model", "main");

  assert.equal(bundle.requestedRevision, "main");
  assert.equal(bundle.resolvedRevision, SHA);
  assert.equal(bundle.remoteCode.payload.state, "REQUIRED");
  assert.equal(bundle.license?.payload.declaredIdentifier, "apache-2.0");

  for (const file of bundle.fileManifest.payload) {
    assert.equal(file.repoCommit, SHA);
  }

  assert.ok(bundle.bundleDigest.length === 64);
});

test("collector never downloads repository Python code while gathering evidence", async () => {
  const { fetchImpl, calls } = fakeHubFetch();
  const collector = new HuggingFaceEvidenceCollector({
    fetchImpl,
    now: () => new Date("2026-11-14T14:00:00.000Z"),
  });

  await collector.collect("example/custom-model", "main");

  const pythonGets = calls.filter(
    (call) =>
      call.method === "GET" &&
      call.url.toLowerCase().endsWith(".py"),
  );

  assert.deepEqual(pythonGets, []);
});

test("same immutable evidence produces same bundle digest across capture times", async () => {
  const a = fakeHubFetch();
  const b = fakeHubFetch();

  const collectorA = new HuggingFaceEvidenceCollector({
    fetchImpl: a.fetchImpl,
    now: () => new Date("2026-11-14T14:00:00.000Z"),
  });
  const collectorB = new HuggingFaceEvidenceCollector({
    fetchImpl: b.fetchImpl,
    now: () => new Date("2026-11-14T14:05:00.000Z"),
  });

  const left = await collectorA.collect("example/custom-model", "main");
  const right = await collectorB.collect("example/custom-model", "main");

  assert.notEqual(left.capturedAt, right.capturedAt);
  assert.equal(left.bundleDigest, right.bundleDigest);
});

test("collector fails closed if a HEAD response resolves to a different commit", async () => {
  const { fetchImpl: baseFetch } = fakeHubFetch();

  const fetchImpl = async (url, init = {}) => {
    const response = await baseFetch(url, init);

    if ((init.method ?? "GET") === "HEAD") {
      const headers = new Headers(response.headers);
      headers.set(
        "x-repo-commit",
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      );

      return new Response(null, {
        status: response.status,
        headers,
      });
    }

    return response;
  };

  const collector = new HuggingFaceEvidenceCollector({
    fetchImpl,
    now: () => new Date("2026-11-14T14:00:00.000Z"),
  });

  await assert.rejects(
    () => collector.collect("example/custom-model", "main"),
    /expected 0123456789abcdef/,
  );
});


test("collector retries a transient network failure and then succeeds", async () => {
  const base = fakeHubFetch();
  let modelInfoAttempts = 0;

  const fetchImpl = async (url, init = {}) => {
    const value = String(url);

    if (
      (init.method ?? "GET") === "GET" &&
      value.includes("/api/models/example/custom-model/revision/main")
    ) {
      modelInfoAttempts += 1;

      if (modelInfoAttempts === 1) {
        const cause = new Error("simulated connection reset");
        cause.code = "ECONNRESET";

        const failure = new TypeError("fetch failed");
        failure.cause = cause;
        throw failure;
      }
    }

    return base.fetchImpl(url, init);
  };

  const delays = [];

  const collector = new HuggingFaceEvidenceCollector({
    fetchImpl,
    retryAttempts: 3,
    retryBaseDelayMs: 10,
    sleep: async (ms) => {
      delays.push(ms);
    },
    now: () => new Date("2026-11-14T14:00:00.000Z"),
  });

  const bundle = await collector.collect(
    "example/custom-model",
    "main",
  );

  assert.equal(bundle.resolvedRevision, SHA);
  assert.equal(modelInfoAttempts, 2);
  assert.deepEqual(delays, [10]);
});

test("collector does not retry deterministic 404 responses", async () => {
  let attempts = 0;

  const fetchImpl = async () => {
    attempts += 1;
    return new Response("not found", {
      status: 404,
    });
  };

  const delays = [];

  const collector = new HuggingFaceEvidenceCollector({
    fetchImpl,
    retryAttempts: 3,
    retryBaseDelayMs: 10,
    sleep: async (ms) => {
      delays.push(ms);
    },
  });

  await assert.rejects(
    () => collector.collect("example/missing-model", "main"),
    (error) => {
      assert.equal(error.code, "HF_NOT_FOUND");
      return true;
    },
  );

  assert.equal(attempts, 1);
  assert.deepEqual(delays, []);
});
