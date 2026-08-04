import type { Page } from '@playwright/test';

import type { RegistrationObserver } from './registration-observer';
import {
  type BackendEvidence,
  type FlowResult,
  FunnelOutcome,
  LessonEvidence,
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

function containsExplicitInactivity(value: unknown): boolean {
  if (!record(value)) return false;
  return Object.entries(value).some(([key, item]) => {
    if (/cancel/i.test(key)) {
      return item === true || /cancel/i.test(String(item));
    }
    if (/status/i.test(key) && typeof item === 'string') {
      return /cancel|inactive|deleted|completed/i.test(item);
    }
    if (/^(?:is[-_]?active|active)$/i.test(key)) return item === false;
    return false;
  });
}

function futureLessonDate(attributes: Record<string, unknown>): boolean | null {
  for (const [key, value] of Object.entries(attributes)) {
    if (!/(?:^|[-_])(date|time|start|scheduled)(?:$|[-_])/i.test(key)) continue;
    if (/created|updated/i.test(key) || typeof value !== 'string') continue;
    const timestamp = Date.parse(value);
    if (Number.isFinite(timestamp)) return timestamp >= Date.now();
  }
  return null;
}

function explicitStudentMatch(
  resource: Resource,
  userId: string | undefined
): boolean | null {
  if (!userId) return null;
  if (record(resource.attributes)) {
    for (const [key, value] of Object.entries(resource.attributes)) {
      if (!/^student[-_]?id$/i.test(key)) continue;
      if (typeof value === 'string' || typeof value === 'number') {
        return String(value) === userId;
      }
    }
  }
  if (!record(resource.relationships)) return null;
  const student = resource.relationships.student;
  if (!record(student) || !record(student.data)) return null;
  const id = student.data.id;
  return typeof id === 'string' || typeof id === 'number'
    ? String(id) === userId
    : null;
}

export function parseLessonRecords(
  lessons: unknown,
  userId?: string
): { lessonRecords: number; lessonEvidence: LessonEvidence } {
  const records = resources(lessons, 'data');
  const evidence = records.map((resource) => {
    const attributes = record(resource.attributes) ? resource.attributes : {};
    if (containsExplicitInactivity(attributes)) return LessonEvidence.INACTIVE;
    if (explicitStudentMatch(resource, userId) === false) {
      return LessonEvidence.INACTIVE;
    }
    const future = futureLessonDate(attributes);
    if (future === false) return LessonEvidence.INACTIVE;
    if (future === true) return LessonEvidence.ACTIVE;
    return LessonEvidence.INDETERMINATE;
  });

  const lessonEvidence = evidence.includes(LessonEvidence.ACTIVE)
    ? LessonEvidence.ACTIVE
    : records.length === 0 ||
        evidence.every((item) => item === LessonEvidence.INACTIVE)
      ? LessonEvidence.INACTIVE
      : LessonEvidence.INDETERMINATE;
  return { lessonRecords: records.length, lessonEvidence };
}

export function parseBackendEvidence(
  balances: unknown,
  lessons: unknown,
  userId?: string
): BackendEvidence {
  const trialType = resources(balances, 'included').find(
    (item) =>
      String(item.type).replace(/[^a-z]/gi, '').toLowerCase() === 'tutortypes' &&
      record(item.attributes) &&
      item.attributes.alias === 'trial'
  );
  if (
    !trialType ||
    (typeof trialType.id !== 'string' && typeof trialType.id !== 'number')
  ) {
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
  const lessonRecords = parseLessonRecords(lessons, userId);
  return {
    trialBalanceFound: true,
    lessonsScheduled,
    ...lessonRecords
  };
}

export function isBookedBackend(evidence: BackendEvidence): boolean {
  return (
    evidence.trialBalanceFound &&
    evidence.lessonsScheduled >= 1 &&
    evidence.lessonEvidence === LessonEvidence.ACTIVE
  );
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
  return parseBackendEvidence(balances, lessons, userId);
}

async function pollBackend(page: Page, userId: string): Promise<BackendEvidence> {
  const deadline = Date.now() + 30_000;
  let last: BackendEvidence | undefined;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      last = await readBackend(page, userId);
      if (isBookedBackend(last)) {
        return last;
      }
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
      if (isBookedBackend(backend)) {
        return {
          outcome: FunnelOutcome.BOOKED,
          reason:
            'Backend confirms trial lessons-scheduled and an active future lesson',
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
