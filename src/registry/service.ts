import {
  digestCanonicalJson,
} from "../qualification/canonical.js";
import type {
  RegistryArtifactRevision,
  RegistryCandidate,
  RegistryDeployment,
  RegistryDeploymentSummary,
  RegistryEnvironment,
  RegistryEvent,
  RegistryOrganization,
  RegistryWorkload,
} from "./types.js";
import type {
  RegistryRepository,
} from "./store.js";
import {
  RegistryError,
} from "./store.js";

function assertUnique(
  values:
    { id: string }[],
  id: string,
  label: string,
): void {
  if (
    values.some(
      (item) =>
        item.id === id,
    )
  ) {
    throw new RegistryError(
      "REGISTRY_DUPLICATE_ID",
      `${label} already exists: ${id}`,
    );
  }
}

function event(
  type:
    RegistryEvent["type"],
  entityId: string,
  occurredAt: string,
  detail: string,
): RegistryEvent {
  return {
    id:
      `${type.toLowerCase()}-${digestCanonicalJson({
        entityId,
        occurredAt,
        detail,
      }).slice(0, 20)}`,
    type,
    entityId,
    occurredAt,
    detail,
  };
}

function requireOrganization(
  state:
    Awaited<
      ReturnType<
        RegistryRepository["read"]
      >
    >,
  organizationId: string,
): void {
  if (
    !state.organizations.some(
      (item) =>
        item.id ===
        organizationId,
    )
  ) {
    throw new RegistryError(
      "REGISTRY_REFERENCE_ERROR",
      `Unknown organization: ${organizationId}`,
    );
  }
}

export class ModelRegistryService {
  constructor(
    private readonly repository:
      RegistryRepository,
  ) {}

  async registerOrganization(
    item:
      RegistryOrganization,
    occurredAt: string,
  ): Promise<void> {
    await this.repository.transact(
      (state) => {
        assertUnique(
          state.organizations,
          item.id,
          "Organization",
        );

        state.organizations.push(
          structuredClone(item),
        );

        state.events.push(
          event(
            "ORGANIZATION_REGISTERED",
            item.id,
            occurredAt,
            item.name,
          ),
        );
      },
    );
  }

  async registerEnvironment(
    item:
      RegistryEnvironment,
    occurredAt: string,
  ): Promise<void> {
    await this.repository.transact(
      (state) => {
        assertUnique(
          state.environments,
          item.id,
          "Environment",
        );

        requireOrganization(
          state,
          item.organizationId,
        );

        state.environments.push(
          structuredClone(item),
        );

        state.events.push(
          event(
            "ENVIRONMENT_REGISTERED",
            item.id,
            occurredAt,
            item.name,
          ),
        );
      },
    );
  }

  async registerWorkload(
    item:
      RegistryWorkload,
    occurredAt: string,
  ): Promise<void> {
    await this.repository.transact(
      (state) => {
        assertUnique(
          state.workloads,
          item.id,
          "Workload",
        );

        state.workloads.push(
          structuredClone(item),
        );

        state.events.push(
          event(
            "WORKLOAD_REGISTERED",
            item.id,
            occurredAt,
            `${item.packId}@${item.packVersion}`,
          ),
        );
      },
    );
  }

  async registerCandidate(
    item:
      RegistryCandidate,
    occurredAt: string,
  ): Promise<void> {
    await this.repository.transact(
      (state) => {
        assertUnique(
          state.candidates,
          item.id,
          "Candidate",
        );

        requireOrganization(
          state,
          item.organizationId,
        );

        state.candidates.push(
          structuredClone(item),
        );

        state.events.push(
          event(
            "CANDIDATE_REGISTERED",
            item.id,
            occurredAt,
            item.repositoryOrModelId,
          ),
        );
      },
    );
  }

  async registerArtifactRevision(
    item:
      RegistryArtifactRevision,
    occurredAt: string,
  ): Promise<void> {
    await this.repository.transact(
      (state) => {
        assertUnique(
          state.artifactRevisions,
          item.id,
          "Artifact revision",
        );

        if (
          !state.candidates.some(
            (candidate) =>
              candidate.id ===
              item.candidateId,
          )
        ) {
          throw new RegistryError(
            "REGISTRY_REFERENCE_ERROR",
            `Unknown candidate: ${item.candidateId}`,
          );
        }

        if (
          item.exactArtifactBindingProven &&
          item.runtimeBindingScope !==
            "EXACT_ARTIFACT"
        ) {
          throw new RegistryError(
            "REGISTRY_BINDING_ERROR",
            "Exact artifact binding cannot be proven under provider-model identity scope",
          );
        }

        state.artifactRevisions.push(
          structuredClone(item),
        );

        state.events.push(
          event(
            "ARTIFACT_REGISTERED",
            item.id,
            occurredAt,
            item.runtimeBindingScope,
          ),
        );
      },
    );
  }

  async registerDeployment(
    item:
      RegistryDeployment,
    occurredAt: string,
  ): Promise<void> {
    await this.repository.transact(
      (state) => {
        assertUnique(
          state.deployments,
          item.id,
          "Deployment",
        );

        requireOrganization(
          state,
          item.organizationId,
        );

        if (
          !state.environments.some(
            (environment) =>
              environment.id ===
                item.environmentId &&
              environment.organizationId ===
                item.organizationId,
          )
        ) {
          throw new RegistryError(
            "REGISTRY_REFERENCE_ERROR",
            `Unknown environment: ${item.environmentId}`,
          );
        }

        if (
          !state.workloads.some(
            (workload) =>
              workload.id ===
              item.workloadId,
          )
        ) {
          throw new RegistryError(
            "REGISTRY_REFERENCE_ERROR",
            `Unknown workload: ${item.workloadId}`,
          );
        }

        if (
          !state.candidates.some(
            (candidate) =>
              candidate.id ===
                item.candidateId &&
              candidate.organizationId ===
                item.organizationId,
          )
        ) {
          throw new RegistryError(
            "REGISTRY_REFERENCE_ERROR",
            `Unknown candidate: ${item.candidateId}`,
          );
        }

        if (
          !state.artifactRevisions.some(
            (artifact) =>
              artifact.id ===
                item.artifactRevisionId &&
              artifact.candidateId ===
                item.candidateId,
          )
        ) {
          throw new RegistryError(
            "REGISTRY_REFERENCE_ERROR",
            `Unknown artifact revision: ${item.artifactRevisionId}`,
          );
        }

        state.deployments.push(
          structuredClone(item),
        );

        state.events.push(
          event(
            "DEPLOYMENT_REGISTERED",
            item.id,
            occurredAt,
            `${item.environmentId}:${item.workloadId}:${item.candidateId}`,
          ),
        );
      },
    );
  }

  async updateDeploymentDecision(
    deploymentId: string,
    update:
      Pick<
        RegistryDeployment,
        | "qualificationState"
        | "authorizationState"
        | "validityState"
        | "activeBlockers"
        | "latestQualificationRunId"
        | "latestAttestationDigest"
        | "nextReassessmentAt"
        | "updatedAt"
      >,
  ): Promise<void> {
    await this.repository.transact(
      (state) => {
        const deployment =
          state.deployments.find(
            (item) =>
              item.id ===
              deploymentId,
          );

        if (!deployment) {
          throw new RegistryError(
            "REGISTRY_REFERENCE_ERROR",
            `Unknown deployment: ${deploymentId}`,
          );
        }

        Object.assign(
          deployment,
          structuredClone(
            update,
          ),
        );

        state.events.push(
          event(
            "DEPLOYMENT_DECISION_UPDATED",
            deploymentId,
            update.updatedAt,
            `${update.qualificationState}/${update.authorizationState}/${update.validityState}`,
          ),
        );
      },
    );
  }

  async summaries(): Promise<RegistryDeploymentSummary[]> {
    const state =
      await this.repository.read();

    return state.deployments
      .map(
        (deployment) => {
          const environment =
            state.environments.find(
              (item) =>
                item.id ===
                deployment.environmentId,
            )!;

          const workload =
            state.workloads.find(
              (item) =>
                item.id ===
                deployment.workloadId,
            )!;

          const candidate =
            state.candidates.find(
              (item) =>
                item.id ===
                deployment.candidateId,
            )!;

          const artifact =
            state.artifactRevisions.find(
              (item) =>
                item.id ===
                deployment.artifactRevisionId,
            )!;

          return {
            deploymentId:
              deployment.id,
            environment:
              environment.name,
            workload:
              workload.name,
            candidate:
              candidate.displayName,
            artifactIdentity:
              artifact.immutableRevision ??
              candidate.repositoryOrModelId,
            qualificationState:
              deployment.qualificationState,
            authorizationState:
              deployment.authorizationState,
            validityState:
              deployment.validityState,
            blockers: [
              ...deployment.activeBlockers,
            ],
            nextReassessmentAt:
              deployment.nextReassessmentAt,
            exactArtifactBindingProven:
              artifact.exactArtifactBindingProven,
          };
        },
      )
      .sort(
        (a, b) =>
          a.deploymentId.localeCompare(
            b.deploymentId,
          ),
      );
  }
}
