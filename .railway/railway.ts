import { defineRailway, github, project, service } from "railway/iac";
// This repository manages only its own resources in the environment. Other
// repositories export their own partial name.
// See https://docs.railway.com/infrastructure-as-code#multi-repo-projects
export const partial = "admissary";
export default defineRailway(() => {
  const admissary = service("admissary", {
    source: github("chizzydev/admissary", { branch: "main", checkSuites: true }),
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    healthcheck: "/health",
    healthcheckTimeout: 30,
    preDeploy: "node scripts/verify-postgres.mjs",
    replicas: { "us-west2": 1 },
    deploy: { preDeployTimeoutSeconds: 180, restartPolicyMaxRetries: 5 },
  });

  return project("admissary", {
    variables: { managed: false },
    resources: [admissary],
  });
});
