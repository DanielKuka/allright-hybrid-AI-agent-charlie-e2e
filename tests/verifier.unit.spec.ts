import { expect, test, type Page } from '@playwright/test';

import { sanitizedLog } from '../src/artifacts';
import {
  parseRegistration,
  type RegistrationObserver
} from '../src/registration-observer';
import { createTestIdentity, emailFor } from '../src/test-data';
import { FunnelOutcome, LessonEvidence } from '../src/types';
import {
  parseBackendEvidence,
  parseLessonRecords,
  isBookedBackend,
  Verifier
} from '../src/verifier';

const FUTURE_LESSON = '2099-01-01T10:00:00.000Z';
const PAST_LESSON = '2020-01-01T10:00:00.000Z';

function activeLesson(userId = '852948'): unknown {
  return {
    data: [
      {
        type: 'Lessons',
        id: '1',
        attributes: {
          'student-id': userId,
          'scheduled-at': FUTURE_LESSON,
          status: 'scheduled'
        }
      }
    ]
  };
}

function balances(scheduled: number): unknown {
  return {
    included: [
      { type: 'TutorTypes', id: '42', attributes: { alias: 'trial' } }
    ],
    data: [
      {
        type: 'UserBalances',
        attributes: {
          'tutor-type-id': 42,
          'lessons-scheduled': scheduled
        }
      }
    ]
  };
}

function observer(lessonMutationSucceeded: boolean): RegistrationObserver {
  return {
    snapshot: {
      userId: '852948',
      whoUserIs: 'parent',
      registrationSucceeded: true,
      lessonMutationSucceeded
    },
    waitForUser: async () => '852948'
  } as unknown as RegistrationObserver;
}

function pageAt(path: string, scheduled = 1): Page {
  return {
    url: () => `https://stage.allright.com${path}`,
    evaluate: async () => [
      balances(scheduled),
      scheduled > 0 ? activeLesson() : { data: [] }
    ],
    waitForTimeout: async () => undefined
  } as unknown as Page;
}

test('parses trial balance and positive lesson evidence', () => {
  expect(
    parseBackendEvidence(balances(1), activeLesson(), '852948')
  ).toEqual({
    trialBalanceFound: true,
    lessonsScheduled: 1,
    lessonRecords: 1,
    lessonEvidence: LessonEvidence.ACTIVE
  });
});

test('extracts userId and parent persona from registration boundary', () => {
  const parsed = parseRegistration(
    {
      data: {
        relationships: {
          'user-metum': {
            data: {
              attributes: {
                'funnel-data': { who_user_is: 'parent' }
              }
            }
          }
        }
      }
    },
    { data: { id: 852860 } }
  );
  expect(parsed).toEqual({ userId: '852860', whoUserIs: 'parent' });
});

test('does not mistake available balance for a scheduled lesson', () => {
  expect(parseBackendEvidence(balances(0), { data: [] })).toEqual({
    trialBalanceFound: true,
    lessonsScheduled: 0,
    lessonRecords: 0,
    lessonEvidence: LessonEvidence.INACTIVE
  });
});

test('empty, cancelled, past, and unknown lesson payloads are not ACTIVE', () => {
  expect(parseLessonRecords({ data: [] }, '852948').lessonEvidence).toBe(
    LessonEvidence.INACTIVE
  );
  expect(
    parseLessonRecords(
      {
        data: [
          {
            attributes: {
              'student-id': '852948',
              'scheduled-at': FUTURE_LESSON,
              status: 'cancelled'
            }
          }
        ]
      },
      '852948'
    ).lessonEvidence
  ).toBe(LessonEvidence.INACTIVE);
  expect(
    parseLessonRecords(
      {
        data: [
          {
            attributes: {
              'student-id': '852948',
              'scheduled-at': PAST_LESSON
            }
          }
        ]
      },
      '852948'
    ).lessonEvidence
  ).toBe(LessonEvidence.INACTIVE);
  expect(
    parseLessonRecords({ data: [{ id: '1', attributes: {} }] }, '852948')
      .lessonEvidence
  ).toBe(LessonEvidence.INDETERMINATE);
});

test('non-empty unknown lesson schema cannot satisfy BOOKED evidence', () => {
  const backend = parseBackendEvidence(
    balances(1),
    { data: [{ id: '1', attributes: {} }] },
    '852948'
  );

  expect(backend.lessonEvidence).toBe(LessonEvidence.INDETERMINATE);
  expect(isBookedBackend(backend)).toBe(false);
});

test('BOOKED backend evidence overrides a stale AI stuck result', async () => {
  const result = await new Verifier().confirm({
    page: pageAt('/uk/app/dashboard'),
    observer: observer(true),
    navigatorOutcome: {
      status: 'stuck',
      reason: 'Old snapshot still showed lesson-time-select'
    }
  });

  expect(result.outcome).toBe(FunnelOutcome.BOOKED);
  expect(result.backend).toEqual({
    trialBalanceFound: true,
    lessonsScheduled: 1,
    lessonRecords: 1,
    lessonEvidence: LessonEvidence.ACTIVE
  });
});

test('request-gotten product outcome overrides a stale AI stuck result', async () => {
  const result = await new Verifier().confirm({
    page: pageAt('/uk/app/request-gotten'),
    observer: observer(false),
    navigatorOutcome: {
      status: 'stuck',
      reason: 'Agent response arrived after navigation'
    }
  });

  expect(result.outcome).toBe(FunnelOutcome.LEAD_CREATED);
});

test('builds email from captured userId and uses runId only as fallback', () => {
  const identity = createTestIdentity(new Date('2026-01-01T00:00:00Z'));
  expect(emailFor(identity, '852860')).toBe('autotestUser-852860@example.com');
  expect(emailFor(identity)).toContain(identity.runId);
});

test('redacts phone and email from agent artifacts', () => {
  const identity = createTestIdentity(new Date('2026-01-01T00:00:00Z'));
  const log = sanitizedLog(
    [
      {
        step: 1,
        action: {
          type: 'fill',
          selector: '[type="tel"]',
          value: identity.phone,
          reason: `Fill ${identity.email}`
        },
        timestamp: '2026-01-01T00:00:00.000Z'
      }
    ],
    identity
  );
  const serialized = JSON.stringify(log);
  expect(serialized).not.toContain(identity.phone);
  expect(serialized).not.toContain(identity.email);
  expect(serialized).toContain(identity.phoneMasked);
  expect(serialized).toContain('[redacted-email]');
});
