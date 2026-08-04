import type { AllRightApiClient } from './allright-api-client';
import { sanitizeForArtifact } from './artifacts';
import type { RegistrationObserver } from './registration-observer';
import type { SessionAuthObserver } from './session-auth-observer';
import {
  type CleanupEvidence,
  type FlowResult,
  FunnelOutcome,
  type LifecycleVerdict
} from './types';

const ACCEPTED_OUTCOMES = new Set([
  FunnelOutcome.BOOKED,
  FunnelOutcome.LEAD_CREATED
]);

function safeReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const sanitized = sanitizeForArtifact(message);
  return typeof sanitized === 'string' ? sanitized : 'Cleanup failed';
}

export async function cleanupCreatedUser(params: {
  registrationObserver: Pick<RegistrationObserver, 'snapshot' | 'waitForUser'>;
  sessionAuthObserver: Pick<SessionAuthObserver, 'waitForSessionAuth'>;
  apiClient: Pick<AllRightApiClient, 'markUserDeleted'>;
  authTimeoutMs?: number;
}): Promise<CleanupEvidence> {
  const captured = params.registrationObserver.snapshot;
  let userId = captured.userId;

  if (!userId && captured.registrationSucceeded) {
    try {
      userId =
        (await params.registrationObserver.waitForUser(
          params.authTimeoutMs ?? 10_000
        )) ?? undefined;
    } catch (error) {
      return { status: 'FAILED', reason: safeReason(error) };
    }
    if (!userId) {
      return {
        status: 'FAILED',
        reason: 'Registration succeeded, but its userId was not captured'
      };
    }
  }

  if (!userId) return { status: 'NOT_REQUIRED' };

  try {
    const sessionAuth = await params.sessionAuthObserver.waitForSessionAuth(
      params.authTimeoutMs ?? 10_000
    );
    if (sessionAuth.userId !== userId) {
      throw new Error(
        `OAuth user_id ${sessionAuth.userId} does not match registration userId ${userId}`
      );
    }
    const cleanup = await params.apiClient.markUserDeleted(
      userId,
      sessionAuth.accessToken
    );
    return { status: 'DELETED', httpStatus: cleanup.status };
  } catch (error) {
    return { status: 'FAILED', reason: safeReason(error) };
  }
}

export function evaluateLifecycle(params: {
  result: FlowResult;
  cleanup: CleanupEvidence;
  userCreated: boolean;
}): LifecycleVerdict {
  const businessPassed = ACCEPTED_OUTCOMES.has(params.result.outcome);
  const cleanupPassed = params.userCreated
    ? params.cleanup.status === 'DELETED'
    : params.cleanup.status === 'NOT_REQUIRED';
  const failures: string[] = [];

  if (!businessPassed) {
    const reason = sanitizeForArtifact(params.result.reason);
    failures.push(
      `Business outcome ${params.result.outcome}: ${
        typeof reason === 'string' ? reason : 'Failure reason unavailable'
      }`
    );
  }
  if (!cleanupPassed) {
    failures.push(
      params.cleanup.status === 'FAILED'
        ? `Cleanup lifecycle failure: ${params.cleanup.reason}`
        : params.userCreated
          ? `Created user requires cleanup status DELETED, got ${params.cleanup.status}`
          : `No created user requires cleanup status NOT_REQUIRED, got ${params.cleanup.status}`
    );
  }

  return { businessPassed, cleanupPassed, failures };
}
