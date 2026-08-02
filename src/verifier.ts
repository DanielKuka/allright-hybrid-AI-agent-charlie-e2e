import type { Page } from '@playwright/test';

import type { RegistrationObserver } from './registration-observer';
import {
  type BackendEvidence,
  type FlowResult,
  FunnelOutcome,
  type NavigatorOutcome
} from './types';

interface Resource {
  id?: unknown;
  type?: unknown;
  attributes?: unknown;
  relationships?: unknown;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function resources(value: unknown, key: 'data' | 'included'): Resource[] {
  if (!record(value) || !Array.isArray(value[key])) {
    throw new Error(`Backend response does not contain ${key}[]`);
  }
  return value[key].filter(record);
}

function tutorTypeId(balance: Resource): string | null {
  if (record(balance.attributes)) {
    const id = balance.attributes['tutor-type-id'];
    if (typeof id === 'string' || typeof id === 'number') return String(id);
  }
  if (!record(balance.relationships)) return null;
  const relation = balance.relationships['tutor-type'];
  if (!record(relation) || !record(relation.data)) return null;
  const id = relation.data.id;
  return typeof id === 'string' || typeof id === 'number' ? String(id) : null;
}

export function parseBackendEvidence(
  balances: unknown,
  lessons: unknown
): BackendEvidence {
  const trialType = resources(balances, 'included').find(
    (item) =>
      String(item.type).replace(/[^a-z]/gi, '').toLowerCase() === 'tutortypes' &&
      record(item.attributes) &&
      item.attributes.alias === 'trial'
  );
  if (!trialType || (typeof trialType.id !== 'string' && typeof trialType.id !== 'number')) {
    throw new Error('TutorType alias="trial" was not found');
  }
  const rows = resources(balances, 'data').filter(
    (item) => tutorTypeId(item) === String(trialType.id)
  );
  if (rows.length === 0) throw new Error('Trial balance row was not found');
  const lessonsScheduled = rows.reduce((sum, item) => {
    if (!record(item.attributes)) return sum;
    const value = Number(item.attributes['lessons-scheduled']);
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);
  return {
    trialBalanceFound: true,
    lessonsScheduled,
    lessonRecords: resources(lessons, 'data').length
  };
}

async function readBackend(page: Page, userId: string): Promise<BackendEvidence> {
  const [balances, lessons] = await page.evaluate(async (id) => {
    const paths = [
      `/api/v1/users/${encodeURIComponent(id)}/user-balances`,
      `/api/v1/lessons?filter[student_id]=${encodeURIComponent(id)}`
    ];
    return Promise.all(
      paths.map(async (path) => {
        const response = await fetch(path, { credentials: 'include' });
        if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
        return response.json() as Promise<unknown>;
      })
    );
  }, userId);
  return parseBackendEvidence(balances, lessons);
}

async function pollBackend(page: Page, userId: string): Promise<BackendEvidence> {
  const deadline = Date.now() + 30_000;
  let last: BackendEvidence | undefined;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      last = await readBackend(page, userId);
      if (last.lessonsScheduled >= 1 && last.lessonRecords >= 1) return last;
    } catch (error) {
      lastError = error;
    }
    await page.waitForTimeout(1_000);
  }
  if (last) return last;
  throw new Error('Backend verification failed', { cause: lastError });
}

export class Verifier {
  async confirm(params: {
    page: Page;
    observer: RegistrationObserver;
    navigatorOutcome: NavigatorOutcome;
  }): Promise<FlowResult> {
    const { page, observer, navigatorOutcome } = params;
    const terminalUrl = page.url();
    const captured = observer.snapshot;
    const userId = captured.userId ?? (await observer.waitForUser());
    const path = new URL(terminalUrl).pathname;

    if (userId && /\/request-gotten\/?$/.test(path)) {
      return {
        outcome: FunnelOutcome.LEAD_CREATED,
        reason: 'Account created; funnel completed through request-gotten',
        terminalUrl,
        userId,
        ...(captured.whoUserIs ? { whoUserIs: captured.whoUserIs } : {})
      };
    }

    // The UI may reach the dashboard, or POST /lessons may finish, while the
    // AI is still reasoning over the previous booking-screen snapshot. These
    // deterministic product signals take priority over navigator `stuck`.
    if (
      userId &&
      (captured.lessonMutationSucceeded || /\/dashboard\/?$/.test(path))
    ) {
      const backend = await pollBackend(page, userId);
      if (backend.lessonsScheduled >= 1 && backend.lessonRecords >= 1) {
        return {
          outcome: FunnelOutcome.BOOKED,
          reason:
            'Backend confirms trial lessons-scheduled and a filtered lesson record',
          terminalUrl,
          userId,
          ...(captured.whoUserIs ? { whoUserIs: captured.whoUserIs } : {}),
          backend
        };
      }
      return {
        outcome: FunnelOutcome.FAILED,
        reason: 'User exists, but backend does not confirm a trial lesson',
        terminalUrl,
        userId,
        backend
      };
    }

    if (navigatorOutcome.status !== 'done') {
      return {
        outcome: FunnelOutcome.FAILED,
        reason: `Agent did not finish: [${navigatorOutcome.status}] ${navigatorOutcome.reason}`,
        terminalUrl,
        ...(userId ? { userId } : {})
      };
    }
    if (!userId) {
      return {
        outcome: FunnelOutcome.FAILED,
        reason: 'POST /api/v1/users with data.id was not captured',
        terminalUrl
      };
    }

    return {
      outcome: FunnelOutcome.FAILED,
      reason: `No verifier is defined for terminal path ${path}`,
      terminalUrl,
      userId
    };
  }
}
