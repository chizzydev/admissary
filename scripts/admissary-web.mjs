import {
  access,
  readFile,
} from "node:fs/promises";

import {
  createAdmissaryWebServer,
  readJudgeSnapshot,
} from "./admissary-web-lib.mjs";

function envTokenMap() {
  const tokens = {};

  if (
    process.env.ADMISSARY_VIEWER_TOKEN
  ) {
    tokens[
      process.env.ADMISSARY_VIEWER_TOKEN
    ] = "VIEWER";
  }

  if (
    process.env.ADMISSARY_ADMIN_TOKEN
  ) {
    tokens[
      process.env.ADMISSARY_ADMIN_TOKEN
    ] = "ADMIN";
  }

  if (
    process.env.ADMISSARY_ADMISSION_TOKEN
  ) {
    tokens[
      process.env.ADMISSARY_ADMISSION_TOKEN
    ] = "ADMISSION";
  }

  if (
    process.env.ADMISSARY_OPERATOR_TOKEN
  ) {
    tokens[
      process.env.ADMISSARY_OPERATOR_TOKEN
    ] = "OPERATOR";
  }

  if (
    process.env.ADMISSARY_APPROVER_TOKEN
  ) {
    tokens[
      process.env.ADMISSARY_APPROVER_TOKEN
    ] = "APPROVER";
  }

  return tokens;
}

const requestedPort =
  Number(
    process.env.PORT ??
    process.argv[2] ??
    "4313",
  );

if (
  !Number.isInteger(
    requestedPort,
  ) ||
  requestedPort < 0 ||
  requestedPort > 65535
) {
  throw new Error(
    `Invalid port: ${requestedPort}`,
  );
}

const host =
  process.env.HOST ??
  "127.0.0.1";

const mode =
  process.env.ADMISSARY_MODE ??
  "judge-demo";

const snapshotPath =
  process.env.ADMISSARY_SNAPSHOT_PATH ??
  undefined;

const verifierManifestPath =
  process.env.ADMISSARY_VERIFIER_MANIFEST_PATH ??
  undefined;

const verifierContextPath =
  process.env.ADMISSARY_VERIFIER_CONTEXT_PATH ??
  undefined;

const auditFile =
  process.env.ADMISSARY_AUDIT_FILE ??
  null;


async function attestationTrustStore() {
  const keyId =
    process.env
      .ADMISSARY_ATTESTATION_KEY_ID;

  const publicKeyPath =
    process.env
      .ADMISSARY_ATTESTATION_PUBLIC_KEY_PATH;

  if (
    !keyId &&
    !publicKeyPath
  ) {
    return {};
  }

  if (
    !keyId ||
    !publicKeyPath
  ) {
    throw new Error(
      "ADMISSARY_ATTESTATION_KEY_ID and ADMISSARY_ATTESTATION_PUBLIC_KEY_PATH must be supplied together",
    );
  }

  return {
    [keyId]:
      await readFile(
        publicKeyPath,
        "utf8",
      ),
  };
}

const secureTransport =
  process.env.ADMISSARY_PUBLIC_HTTPS ===
  "1";

await readJudgeSnapshot({
  snapshotPath,
  snapshotSeedPath: "deploy/seed/SEED_MANIFEST.json",
});

const database = mode === "production"
  ? await (await import('./postgres-state.mjs')).openProductionDatabase(process.env.DATABASE_URL, {
      product: JSON.parse(await readFile('results/ADMISSARY_R10C5_PRODUCT_STATE.json', 'utf8')),
      assurance: JSON.parse(await readFile('results/ADMISSARY_R10C5_ASSURANCE_STATE.json', 'utf8')),
    })
  : null;

const server =
  createAdmissaryWebServer({
    mode,
    ...(database ? { productRepository: database.productRepository, productAssuranceRepository: database.productAssuranceRepository, persistenceCheck: database.check } : {}),
    snapshotPath,
    verifierManifestPath,
    verifierContextPath,
    auditFile,
    secureTransport,
    authTokens:
      envTokenMap(),
    attestationTrustStore:
      await attestationTrustStore(),
    productStatePath:
      process.env.ADMISSARY_PRODUCT_STATE_PATH ??
      "results/ADMISSARY_R10C5_PRODUCT_STATE.json",
    productAssuranceStatePath:
      process.env.ADMISSARY_PRODUCT_ASSURANCE_STATE_PATH ??
      "results/ADMISSARY_R10C5_ASSURANCE_STATE.json",
  });

server.listen(
  requestedPort,
  host,
  () => {
    const address =
      server.address();

    if (
      !address ||
      typeof address ===
        "string"
    ) {
      throw new Error(
        "Unable to determine server address",
      );
    }

    console.log(
      `ADMISSARY_WEB_HOST=${host}`,
    );

    console.log(
      `ADMISSARY_WEB_PORT=${address.port}`,
    );

    console.log(
      `ADMISSARY_WEB_URL=http://${host}:${address.port}`,
    );

    console.log(
      `ADMISSARY_WEB_MODE=${mode}`,
    );

    console.log(
      "ADMISSARY_WEB_READY=YES",
    );
  },
);

for (
  const signal of
  ["SIGINT", "SIGTERM"]
) {
  process.on(
    signal,
    () => {
      server.close(
        async () => { await database?.close(); process.exit(0); },
      );
    },
  );
}
