import { expect, test } from '@playwright/test';

import { cleanupCreatedUser, evaluateLifecycle } from '../src/lifecycle';
import type { CleanupEvidence } from '../src/types';
import { FunnelOutcome } from '../src/types';

function registration(userId?: string, registrationSucceeded = Boolean(userId)) {
  return {
    snapshot: {
      ...(userId ? { userId } : {}),
      registrationSucceeded,
      lessonMutationSucceeded: false
    },
    waitForUser: async () => userId ?? null
  };
}

test('OAuth userId mismatch prevents destructive PATCH', async () => {
  let patchCalls = 0;
  const cleanup = await cleanupCreatedUser({
    registrationObserver: registration('registration-user'),
    sessionAuthObserver: {
      waitForSessionAuth: async () => ({
        accessToken: 'unit-credential',
        userId: 'different-oauth-user'
      })
    },
    apiClient: {
      markUserDeleted: async () => {
        patchCalls += 1;
        return { userId: 'registration-user', status: 200 };
      }
    }
  });

  expect(cleanup).toEqual({
    status: 'FAILED',
    reason:
      'OAuth user_id different-oauth-user does not match registration userId registration-user'
  });
  expect(patchCalls).toBe(0);
});

test('created user is marked DELETED after matched OAuth cleanup', async () => {
  const cleanup = await cleanupCreatedUser({
    registrationObserver: registration('852860'),
    sessionAuthObserver: {
      waitForSessionAuth: async () => ({
        accessToken: 'unit-credential',
        userId: '852860'
      })
    },
    apiClient: {
      markUserDeleted: async (userId) => ({ userId, status: 200 })
    }
  });

  expect(cleanup).toEqual({ status: 'DELETED', httpStatus: 200 });
});

test('absent user requires no cleanup', async () => {
  const cleanup = await cleanupCreatedUser({
    registrationObserver: registration(),
    sessionAuthObserver: {
      waitForSessionAuth: async () => {
        throw new Error('must not be called');
      }
    },
    apiClient: {
      markUserDeleted: async () => {
        throw new Error('must not be called');
      }
    }
  });

  expect(cleanup).toEqual({ status: 'NOT_REQUIRED' });
});

test('successful registration without a captured userId is a cleanup failure', async () => {
  const cleanup = await cleanupCreatedUser({
    registrationObserver: registration(undefined, true),
    sessionAuthObserver: {
      waitForSessionAuth: async () => {
        throw new Error('must not be called without registration userId');
      }
    },
    apiClient: {
      markUserDeleted: async () => {
        throw new Error('must not be called without registration userId');
      }
    },
    authTimeoutMs: 1
  });

  expect(cleanup).toEqual({
    status: 'FAILED',
    reason: 'Registration succeeded, but its userId was not captured'
  });
});

test('created user requires DELETED and cleanup failure remains fatal', () => {
  const cleanup: CleanupEvidence = {
    status: 'FAILED',
    reason: 'endpoint rejected cleanup'
  };
  const verdict = evaluateLifecycle({
    result: {
      outcome: FunnelOutcome.BOOKED,
      reason: 'booking confirmed',
      terminalUrl: 'https://stage.allright.com/uk/app/dashboard'
    },
    cleanup,
    userCreated: true
  });

  expect(verdict.businessPassed).toBe(true);
  expect(verdict.cleanupPassed).toBe(false);
  expect(verdict.failures).toContain(
    'Cleanup lifecycle failure: endpoint rejected cleanup'
  );
});

test('successful cleanup cannot mask product failure', () => {
  const verdict = evaluateLifecycle({
    result: {
      outcome: FunnelOutcome.FAILED,
      reason: 'booking was not proven',
      terminalUrl: 'https://stage.allright.com/unknown'
    },
    cleanup: { status: 'DELETED', httpStatus: 200 },
    userCreated: true
  });

  expect(verdict.businessPassed).toBe(false);
  expect(verdict.cleanupPassed).toBe(true);
  expect(verdict.failures[0]).toContain('Business outcome FAILED');
});
