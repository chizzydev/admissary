import {
  digestCanonicalJson,
} from "../qualification/canonical.js";
import type {
  AuthorizationState,
  ValidityState,
} from "../qualification/types.js";
import type {
  PersistenceRepository,
} from "../persistence/store.js";
import {
  PersistenceError,
} from "../persistence/store.js";
import type {
  ActorIdentity,
  AuditEvent,
  AuthorizationEvent,
  DeploymentAuthorizationDecision,
  PersistenceState,
  ProofTimelineEntry,
  QualificationRunRecord,
  ValidityEvent,
} from "../persistence/types.js";

export class AuthorizationError extends Error {
  readonly code: string;

  constructor(
    code: string,
    message: string,
  ) {
    super(message);
    this.name = "AuthorizationError";
    this.code = code;
  }
}

function assertIsoTimestamp(
  value: string,
): void {
  const date = new Date(value);

  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString() !== value
  ) {
    throw new AuthorizationError(
      "AUTH_INVALID_TIMESTAMP",
      `Timestamp must be canonical ISO-8601: ${value}`,
    );
  }
}

function stableEventId(
  prefix: string,
  value: unknown,
): string {
  return `${prefix}-${digestCanonicalJson(value).slice(0, 24)}`;
}

function hasApprovalRole(
  actor: ActorIdentity,
): boolean {
  return (
    actor.roles.includes("APPROVER") ||
    actor.roles.includes("ADMIN")
  );
}

function latestAuthorizationState(
  state: PersistenceState,
  runId: string,
): AuthorizationState {
  const events = state.authorizationEvents
    .filter(
      (event) => event.runId === runId,
    );

  return (
    events.at(-1)?.state ??
    "NOT_REQUESTED"
  );
}

function latestValidityState(
  state: PersistenceState,
  runId: string,
): ValidityState {
  const events = state.validityEvents
    .filter(
      (event) => event.runId === runId,
    );

  return (
    events.at(-1)?.state ??
    "CURRENT"
  );
}

function findRun(
  state: PersistenceState,
  runId: string,
): QualificationRunRecord {
  const run =
    state.qualificationRuns.find(
      (record) =>
        record.runId === runId,
    );

  if (!run) {
    throw new AuthorizationError(
      "AUTH_RUN_NOT_FOUND",
      `Qualification run not found: ${runId}`,
    );
  }

  return run;
}

function assertUniqueEventId(
  state: PersistenceState,
  id: string,
): void {
  const duplicate =
    state.authorizationEvents.some(
      (event) => event.id === id,
    ) ||
    state.validityEvents.some(
      (event) => event.id === id,
    ) ||
    state.auditEvents.some(
      (event) => event.id === id,
    );

  if (duplicate) {
    throw new PersistenceError(
      "PERSISTENCE_DUPLICATE_EVENT",
      `Duplicate persisted event ID: ${id}`,
    );
  }
}

export class QualificationHistoryService {
  constructor(
    private readonly repository:
      PersistenceRepository,
  ) {}

  async finalizeQualificationRun(
    input: {
      record: QualificationRunRecord;
      actor: ActorIdentity;
    },
  ): Promise<QualificationRunRecord> {
    if (!input.actor.roles.some(role => role === "SYSTEM" || role === "ADMIN")) {
      throw new AuthorizationError("AUTH_FORBIDDEN", "Qualification finalization requires SYSTEM or ADMIN");
    }
    assertIsoTimestamp(
      input.record.finalizedAt,
    );

    return this.repository.transact(
      (state) => {
        if (
          state.qualificationRuns.some(
            (run) =>
              run.runId ===
              input.record.runId,
          )
        ) {
          throw new PersistenceError(
            "PERSISTENCE_DUPLICATE_RUN",
            `Qualification run already finalized: ${input.record.runId}`,
          );
        }

        const run =
          structuredClone(
            input.record,
          );

        const validity: ValidityEvent = {
          id: stableEventId(
            "validity",
            {
              runId: run.runId,
              state: "CURRENT",
              actorId:
                input.actor.id,
              occurredAt:
                run.finalizedAt,
              reason:
                "Qualification finalized",
            },
          ),
          runId: run.runId,
          state: "CURRENT",
          actorId:
            input.actor.id,
          occurredAt:
            run.finalizedAt,
          reason:
            "Qualification finalized",
        };

        const audit: AuditEvent = {
          id: stableEventId(
            "audit",
            {
              type:
                "QUALIFICATION_FINALIZED",
              runId: run.runId,
              actorId:
                input.actor.id,
              occurredAt:
                run.finalizedAt,
              sourceArtifactDigest:
                run.sourceArtifactDigest,
            },
          ),
          type:
            "QUALIFICATION_FINALIZED",
          runId: run.runId,
          actorId:
            input.actor.id,
          occurredAt:
            run.finalizedAt,
          detail:
            `qualification=${run.qualificationState}; source=${run.sourceArtifactDigest}`,
        };

        assertUniqueEventId(
          state,
          validity.id,
        );
        assertUniqueEventId(
          state,
          audit.id,
        );

        state.qualificationRuns.push(
          run,
        );
        state.validityEvents.push(
          validity,
        );
        state.auditEvents.push(
          audit,
        );

        return structuredClone(run);
      },
    );
  }

  async approve(
    input: {
      runId: string;
      actor: ActorIdentity;
      occurredAt: string;
      reason: string;
    },
  ): Promise<AuthorizationEvent> {
    assertIsoTimestamp(
      input.occurredAt,
    );

    return this.repository.transact(
      (state) => {
        if (
          !hasApprovalRole(
            input.actor,
          )
        ) {
          throw new AuthorizationError(
            "AUTH_FORBIDDEN",
            `Actor ${input.actor.id} lacks APPROVER or ADMIN role`,
          );
        }

        const run =
          findRun(
            state,
            input.runId,
          );

        const validity =
          latestValidityState(
            state,
            input.runId,
          );

        if (
          run.qualificationState !==
          "QUALIFIED"
        ) {
          throw new AuthorizationError(
            "AUTH_QUALIFICATION_REQUIRED",
            `Run ${input.runId} is ${run.qualificationState}, not QUALIFIED`,
          );
        }

        if (
          validity !== "CURRENT"
        ) {
          throw new AuthorizationError(
            "AUTH_CURRENT_REQUIRED",
            `Run ${input.runId} validity is ${validity}`,
          );
        }

        if (
          !run.exactArtifactBindingProven
        ) {
          throw new AuthorizationError(
            "AUTH_EXACT_ARTIFACT_REQUIRED",
            `Run ${input.runId} lacks exact artifact binding`,
          );
        }

        const current =
          latestAuthorizationState(
            state,
            input.runId,
          );

        if (
          current === "APPROVED"
        ) {
          throw new AuthorizationError(
            "AUTH_ALREADY_APPROVED",
            `Run ${input.runId} is already APPROVED`,
          );
        }

        const event: AuthorizationEvent = {
          id: stableEventId(
            "authorization",
            {
              runId:
                input.runId,
              state:
                "APPROVED",
              actorId:
                input.actor.id,
              occurredAt:
                input.occurredAt,
              reason:
                input.reason,
            },
          ),
          runId:
            input.runId,
          state:
            "APPROVED",
          actorId:
            input.actor.id,
          actorRoles: [
            ...input.actor.roles,
          ].sort(),
          occurredAt:
            input.occurredAt,
          reason:
            input.reason,
        };

        const audit: AuditEvent = {
          id: stableEventId(
            "audit",
            {
              type:
                "AUTHORIZATION_APPROVED",
              eventId:
                event.id,
            },
          ),
          type:
            "AUTHORIZATION_APPROVED",
          runId:
            input.runId,
          actorId:
            input.actor.id,
          occurredAt:
            input.occurredAt,
          detail:
            input.reason,
        };

        assertUniqueEventId(
          state,
          event.id,
        );
        assertUniqueEventId(
          state,
          audit.id,
        );

        state.authorizationEvents.push(
          event,
        );
        state.auditEvents.push(
          audit,
        );

        return structuredClone(event);
      },
    );
  }

  async revoke(
    input: {
      runId: string;
      actor: ActorIdentity;
      occurredAt: string;
      reason: string;
    },
  ): Promise<AuthorizationEvent> {
    assertIsoTimestamp(
      input.occurredAt,
    );

    return this.repository.transact(
      (state) => {
        if (
          !hasApprovalRole(
            input.actor,
          )
        ) {
          throw new AuthorizationError(
            "AUTH_FORBIDDEN",
            `Actor ${input.actor.id} lacks APPROVER or ADMIN role`,
          );
        }

        findRun(
          state,
          input.runId,
        );

        const current =
          latestAuthorizationState(
            state,
            input.runId,
          );

        if (
          current !== "APPROVED"
        ) {
          throw new AuthorizationError(
            "AUTH_APPROVAL_REQUIRED",
            `Run ${input.runId} is ${current}, not APPROVED`,
          );
        }

        const event: AuthorizationEvent = {
          id: stableEventId(
            "authorization",
            {
              runId:
                input.runId,
              state:
                "REVOKED",
              actorId:
                input.actor.id,
              occurredAt:
                input.occurredAt,
              reason:
                input.reason,
            },
          ),
          runId:
            input.runId,
          state:
            "REVOKED",
          actorId:
            input.actor.id,
          actorRoles: [
            ...input.actor.roles,
          ].sort(),
          occurredAt:
            input.occurredAt,
          reason:
            input.reason,
        };

        const audit: AuditEvent = {
          id: stableEventId(
            "audit",
            {
              type:
                "AUTHORIZATION_REVOKED",
              eventId:
                event.id,
            },
          ),
          type:
            "AUTHORIZATION_REVOKED",
          runId:
            input.runId,
          actorId:
            input.actor.id,
          occurredAt:
            input.occurredAt,
          detail:
            input.reason,
        };

        assertUniqueEventId(
          state,
          event.id,
        );
        assertUniqueEventId(
          state,
          audit.id,
        );

        state.authorizationEvents.push(
          event,
        );
        state.auditEvents.push(
          audit,
        );

        return structuredClone(event);
      },
    );
  }

  async markStale(
    input: {
      runId: string;
      actor: ActorIdentity;
      occurredAt: string;
      reason: string;
    },
  ): Promise<ValidityEvent> {
    assertIsoTimestamp(
      input.occurredAt,
    );

    return this.repository.transact(
      (state) => {
        findRun(
          state,
          input.runId,
        );

        const current =
          latestValidityState(
            state,
            input.runId,
          );

        if (
          current === "STALE"
        ) {
          throw new AuthorizationError(
            "AUTH_ALREADY_STALE",
            `Run ${input.runId} is already STALE`,
          );
        }

        const event: ValidityEvent = {
          id: stableEventId(
            "validity",
            {
              runId:
                input.runId,
              state:
                "STALE",
              actorId:
                input.actor.id,
              occurredAt:
                input.occurredAt,
              reason:
                input.reason,
            },
          ),
          runId:
            input.runId,
          state:
            "STALE",
          actorId:
            input.actor.id,
          occurredAt:
            input.occurredAt,
          reason:
            input.reason,
        };

        const audit: AuditEvent = {
          id: stableEventId(
            "audit",
            {
              type:
                "VALIDITY_STALE",
              eventId:
                event.id,
            },
          ),
          type:
            "VALIDITY_STALE",
          runId:
            input.runId,
          actorId:
            input.actor.id,
          occurredAt:
            input.occurredAt,
          detail:
            input.reason,
        };

        assertUniqueEventId(
          state,
          event.id,
        );
        assertUniqueEventId(
          state,
          audit.id,
        );

        state.validityEvents.push(
          event,
        );
        state.auditEvents.push(
          audit,
        );

        return structuredClone(event);
      },
    );
  }

  async deploymentDecision(
    runId: string,
  ): Promise<DeploymentAuthorizationDecision> {
    const state =
      await this.repository.read();

    const run =
      findRun(
        state,
        runId,
      );

    const authorizationState =
      latestAuthorizationState(
        state,
        runId,
      );

    const validityState =
      latestValidityState(
        state,
        runId,
      );

    const reasons: string[] = [];

    if (
      run.qualificationState !==
      "QUALIFIED"
    ) {
      reasons.push(
        `QUALIFICATION_${run.qualificationState}`,
      );
    }

    if (
      authorizationState !==
      "APPROVED"
    ) {
      reasons.push(
        `AUTHORIZATION_${authorizationState}`,
      );
    }

    if (
      validityState !==
      "CURRENT"
    ) {
      reasons.push(
        `VALIDITY_${validityState}`,
      );
    }

    if (
      !run.exactArtifactBindingProven
    ) {
      reasons.push(
        "EXACT_ARTIFACT_BINDING_UNPROVEN",
      );
    }

    return {
      allowed:
        reasons.length === 0,
      reasons,
      qualificationState:
        run.qualificationState,
      authorizationState,
      validityState,
      exactArtifactBindingProven:
        run.exactArtifactBindingProven,
    };
  }

  async timeline(
    runId: string,
  ): Promise<ProofTimelineEntry[]> {
    const state =
      await this.repository.read();

    const run =
      findRun(
        state,
        runId,
      );

    const entries: ProofTimelineEntry[] = [
      {
        occurredAt:
          run.finalizedAt,
        type:
          "QUALIFICATION",
        runId:
          run.runId,
        actorId:
          "system",
        state:
          run.qualificationState,
        detail:
          `graph=${run.graphRootDigest}; source=${run.sourceArtifactDigest}`,
      },
    ];

    for (
      const event of
      state.authorizationEvents.filter(
        (item) =>
          item.runId === runId,
      )
    ) {
      entries.push({
        occurredAt:
          event.occurredAt,
        type:
          "AUTHORIZATION",
        runId:
          event.runId,
        actorId:
          event.actorId,
        state:
          event.state,
        detail:
          event.reason,
      });
    }

    for (
      const event of
      state.validityEvents.filter(
        (item) =>
          item.runId === runId,
      )
    ) {
      entries.push({
        occurredAt:
          event.occurredAt,
        type:
          "VALIDITY",
        runId:
          event.runId,
        actorId:
          event.actorId,
        state:
          event.state,
        detail:
          event.reason,
      });
    }

    for (
      const event of
      state.auditEvents.filter(
        (item) =>
          item.runId === runId,
      )
    ) {
      entries.push({
        occurredAt:
          event.occurredAt,
        type:
          "AUDIT",
        runId:
          event.runId,
        actorId:
          event.actorId,
        detail:
          `${event.type}: ${event.detail}`,
      });
    }

    return entries.sort(
      (a, b) => {
        const time =
          a.occurredAt.localeCompare(
            b.occurredAt,
          );

        if (time !== 0) {
          return time;
        }

        return (
          a.type.localeCompare(
            b.type,
          )
        );
      },
    );
  }
}
