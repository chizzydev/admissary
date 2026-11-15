import {
  readFile,
  rm,
} from "node:fs/promises";
import {
  createAdmissaryWebServer,
} from "./admissary-web-lib.mjs";

const auditFile =
  "results/.r10-http-audit.jsonl";

await rm(
  auditFile,
  {
    force: true,
  },
);

const ADMIN =
  "r10-admin-fixture-token";
const VIEWER =
  "r10-viewer-fixture-token";

function startServer(
  overrides = {},
) {
  const server =
    createAdmissaryWebServer({
      mode:
        "production-test",
      snapshotPath:
        "deploy/seed/demo-snapshot.json",
      verifierManifestPath:
        "deploy/seed/verifier-manifest.json",
      verifierContextPath:
        "deploy/seed/deployment-context.json",
      secureTransport:
        true,
      auditFile,
      authTokens: {
        [ADMIN]:
          "ADMIN",
        [VIEWER]:
          "VIEWER",
      },
      rateLimit: {
        windowMs:
          60_000,
        max:
          20,
      },
      ...overrides,
    });

  return new Promise(
    (resolve, reject) => {
      server.once(
        "error",
        reject,
      );

      server.listen(
        0,
        "127.0.0.1",
        () =>
          resolve(server),
      );
    },
  );
}

function baseUrl(
  server,
) {
  const address =
    server.address();

  if (
    !address ||
    typeof address ===
      "string"
  ) {
    throw new Error(
      "R10 server address unavailable",
    );
  }

  return `http://127.0.0.1:${address.port}`;
}

async function close(
  server,
) {
  await new Promise(
    (resolve) =>
      server.close(
        resolve,
      ),
  );
}

function requireHeader(
  response,
  name,
  expected = null,
) {
  const value =
    response.headers.get(
      name,
    );

  if (!value) {
    throw new Error(
      `Missing security header: ${name}`,
    );
  }

  if (
    expected &&
    !value.includes(
      expected,
    )
  ) {
    throw new Error(
      `Header ${name} missing expected value ${expected}: ${value}`,
    );
  }

  return value;
}

const server =
  await startServer();

let snapshotDigest;

try {
  const base =
    baseUrl(server);

  if (
    server.requestTimeout !==
      15_000 ||
    server.headersTimeout !==
      10_000 ||
    server.keepAliveTimeout !==
      5_000
  ) {
    throw new Error(
      "R10 server timeout policy mismatch",
    );
  }

  const healthResponse =
    await fetch(
      `${base}/health`,
    );

  if (
    healthResponse.status !==
    200
  ) {
    throw new Error(
      `R10 health HTTP ${healthResponse.status}`,
    );
  }

  for (
    const [
      name,
      expected,
    ] of [
      [
        "content-security-policy",
        "frame-ancestors 'none'",
      ],
      [
        "x-frame-options",
        "DENY",
      ],
      [
        "x-content-type-options",
        "nosniff",
      ],
      [
        "referrer-policy",
        "no-referrer",
      ],
      [
        "permissions-policy",
        "camera=()",
      ],
      [
        "cross-origin-opener-policy",
        "same-origin",
      ],
      [
        "cross-origin-resource-policy",
        "same-origin",
      ],
      [
        "strict-transport-security",
        "max-age=31536000",
      ],
    ]
  ) {
    requireHeader(
      healthResponse,
      name,
      expected,
    );
  }

  const health =
    await healthResponse.json();

  if (
    health.providerCalls !==
      0 ||
    health.mode !==
      "production-test"
  ) {
    throw new Error(
      "R10 health body mismatch",
    );
  }

  const readyResponse =
    await fetch(
      `${base}/ready`,
    );

  if (
    readyResponse.status !==
    200
  ) {
    throw new Error(
      `R10 ready HTTP ${readyResponse.status}`,
    );
  }

  const ready =
    await readyResponse.json();

  if (
    ready.status !==
    "ready"
  ) {
    throw new Error(
      "R10 readiness body mismatch",
    );
  }

  snapshotDigest =
    ready.snapshotDigest;

  const judgeResponse =
    await fetch(
      `${base}/api/judge`,
    );

  if (
    judgeResponse.status !==
    200
  ) {
    throw new Error(
      `R10 judge HTTP ${judgeResponse.status}`,
    );
  }

  const judge =
    await judgeResponse.json();

  if (
    judge.snapshotDigest !==
      snapshotDigest ||
    judge.candidate.model !==
      "deepseek-ai/DeepSeek-V4.1-Flash" ||
    judge.candidate.deployAllowed !==
      false
  ) {
    throw new Error(
      "R10 sealed judge data mismatch",
    );
  }

  const noAuth =
    await fetch(
      `${base}/api/admin/status`,
    );

  if (
    noAuth.status !==
    401
  ) {
    throw new Error(
      `R10 unauthenticated admin status was ${noAuth.status}, expected 401`,
    );
  }

  const viewer =
    await fetch(
      `${base}/api/admin/status`,
      {
        headers: {
          authorization:
            `Bearer ${VIEWER}`,
        },
      },
    );

  if (
    viewer.status !==
    403
  ) {
    throw new Error(
      `R10 viewer admin status was ${viewer.status}, expected 403`,
    );
  }

  const admin =
    await fetch(
      `${base}/api/admin/status`,
      {
        headers: {
          authorization:
            `Bearer ${ADMIN}`,
        },
      },
    );

  if (
    admin.status !==
    200
  ) {
    throw new Error(
      `R10 admin status was ${admin.status}, expected 200`,
    );
  }

  const adminBody =
    await admin.json();

  if (
    adminBody.role !==
      "ADMIN"
  ) {
    throw new Error(
      "R10 admin role mismatch",
    );
  }

  const methodDenied =
    await fetch(
      `${base}/api/judge`,
      {
        method:
          "POST",
      },
    );

  if (
    methodDenied.status !==
    405
  ) {
    throw new Error(
      `R10 POST gate returned ${methodDenied.status}, expected 405`,
    );
  }

  if (
    methodDenied.headers.get(
      "allow",
    ) !== "GET"
  ) {
    throw new Error(
      "R10 method denial missing Allow: GET",
    );
  }

  const root =
    await fetch(
      `${base}/`,
    );

  if (
    root.status !==
    200
  ) {
    throw new Error(
      `R10 root HTTP ${root.status}`,
    );
  }

  const html =
    await root.text();

  if (
    !html.includes(
      "A model name is not a deployment decision",
    )
  ) {
    throw new Error(
      "R10 root lost Judge View thesis",
    );
  }

  const valid =
    await fetch(
      `${base}/api/verify-demo?scenario=valid`,
    ).then(
      (response) =>
        response.json(),
    );

  if (
    valid.result.allowed !==
    true
  ) {
    throw new Error(
      "R10 verifier valid scenario failed",
    );
  }

  const revision =
    await fetch(
      `${base}/api/verify-demo?scenario=revision`,
    ).then(
      (response) =>
        response.json(),
    );

  if (
    revision.result.allowed !==
      false ||
    !revision.result.reasons.some(
      (reason) =>
        reason.code ===
        "CANDIDATE_REVISION_MISMATCH",
    )
  ) {
    throw new Error(
      "R10 revision-mismatch verifier gate failed",
    );
  }
} finally {
  await close(server);
}

const restarted =
  await startServer();

try {
  const base =
    baseUrl(restarted);

  const ready =
    await fetch(
      `${base}/ready`,
    ).then(
      (response) =>
        response.json(),
    );

  if (
    ready.snapshotDigest !==
    snapshotDigest
  ) {
    throw new Error(
      "R10 restart changed sealed snapshot identity",
    );
  }

  const judge =
    await fetch(
      `${base}/api/judge`,
    ).then(
      (response) =>
        response.json(),
    );

  if (
    judge.snapshotDigest !==
      snapshotDigest
  ) {
    throw new Error(
      "R10 restart judge data mismatch",
    );
  }
} finally {
  await close(restarted);
}

const limited =
  await startServer({
    rateLimit: {
      windowMs:
        60_000,
      max:
        2,
    },
  });

try {
  const base =
    baseUrl(limited);

  const first =
    await fetch(
      `${base}/api/verify-demo?scenario=valid`,
    );

  const second =
    await fetch(
      `${base}/api/verify-demo?scenario=valid`,
    );

  const third =
    await fetch(
      `${base}/api/verify-demo?scenario=valid`,
    );

  if (
    first.status !== 200 ||
    second.status !== 200 ||
    third.status !== 429
  ) {
    throw new Error(
      `R10 rate-limit statuses ${first.status},${second.status},${third.status}`,
    );
  }

  if (
    !third.headers.get(
      "retry-after",
    )
  ) {
    throw new Error(
      "R10 rate-limit denial missing Retry-After",
    );
  }
} finally {
  await close(limited);
}

const auditText =
  await readFile(
    auditFile,
    "utf8",
  );

for (
  const forbidden of
  [ADMIN, VIEWER]
) {
  if (
    auditText.includes(
      forbidden,
    )
  ) {
    throw new Error(
      "R10 audit log leaked authentication token",
    );
  }
}

for (
  const expectedStatus of
  ['"status":401', '"status":403', '"status":200', '"status":429']
) {
  if (
    !auditText.includes(
      expectedStatus,
    )
  ) {
    throw new Error(
      `R10 audit log missing ${expectedStatus}`,
    );
  }
}

console.log(
  `R10_SNAPSHOT_DIGEST=${snapshotDigest}`,
);
console.log(
  "R10_SECURITY_HEADERS=PASS",
);
console.log(
  "R10_REQUEST_TIMEOUTS=PASS",
);
console.log(
  "R10_PUBLIC_READ_ONLY=PASS",
);
console.log(
  "R10_ADMIN_UNAUTHENTICATED=DENY",
);
console.log(
  "R10_VIEWER_ADMIN=DENY",
);
console.log(
  "R10_ADMIN_ADMIN=ALLOW",
);
console.log(
  "R10_RATE_LIMIT_GATE=PASS",
);
console.log(
  "R10_AUDIT_LOG_GATE=PASS",
);
console.log(
  "R10_SECRET_LOG_LEAK=NO",
);
console.log(
  "R10_RESTART_GATE=PASS",
);
console.log(
  "R10_SEALED_JUDGE_VIEW_GATE=PASS",
);
console.log(
  "R10_VERIFIER_E2E_GATE=PASS",
);
console.log(
  "ADMISSARY_R10_PRODUCTION_HARDENING_GATE=PASS",
);

await rm(
  auditFile,
  {
    force: true,
  },
);
