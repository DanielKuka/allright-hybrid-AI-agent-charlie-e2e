import type { Page, Request, Response } from '@playwright/test';

import { emailFor } from './test-data';
import type { TestIdentity } from './types';

const CREATE_USER_PATH = /\/api\/v1\/users\/?$/;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function nestedRecord(value: unknown, keys: string[]): Record<string, unknown> | null {
  let current: unknown = value;
  for (const key of keys) {
    if (!record(current)) return null;
    current = current[key];
  }
  return record(current) ? current : null;
}

export function parseRegistration(
  requestBody: unknown,
  responseBody: unknown
): { userId: string; whoUserIs?: string } {
  const funnelData = nestedRecord(requestBody, [
    'data',
    'relationships',
    'user-metum',
    'data',
    'attributes',
    'funnel-data'
  ]);
  const data = record(responseBody) && record(responseBody.data)
    ? responseBody.data
    : null;
  const id = data?.id;
  if (typeof id !== 'string' && typeof id !== 'number') {
    throw new Error('POST /api/v1/users response does not contain data.id');
  }
  const who = funnelData?.who_user_is;
  return {
    userId: String(id),
    ...(typeof who === 'string' ? { whoUserIs: who } : {})
  };
}

export class RegistrationObserver {
  private userId: string | undefined;
  private whoUserIs: string | undefined;
  private lessonMutationSucceeded = false;
  private captureError: Error | undefined;

  constructor(private readonly identity: TestIdentity) {}

  attach(page: Page): void {
    page.on('requestfinished', (request) => {
      void this.captureRequest(request);
    });
    page.on('response', (response) => {
      const request = response.request();
      const url = new URL(response.url());
      if (
        request.method() === 'POST' &&
        url.pathname === '/api/v1/lessons' &&
        response.ok()
      ) {
        this.lessonMutationSucceeded = true;
      }
    });
  }

  hasCapturedUser(): boolean {
    return this.userId !== undefined;
  }

  get snapshot(): {
    userId?: string;
    whoUserIs?: string;
    lessonMutationSucceeded: boolean;
  } {
    return {
      ...(this.userId ? { userId: this.userId } : {}),
      ...(this.whoUserIs ? { whoUserIs: this.whoUserIs } : {}),
      lessonMutationSucceeded: this.lessonMutationSucceeded
    };
  }

  async waitForUser(timeoutMs = 10_000): Promise<string | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.captureError) throw this.captureError;
      if (this.userId) return this.userId;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return null;
  }

  private async captureRequest(request: Request): Promise<void> {
    if (request.method() !== 'POST') return;
    const url = new URL(request.url());
    if (!CREATE_USER_PATH.test(url.pathname)) return;
    try {
      const body = request.postDataJSON() as unknown;
      const response = await request.response();
      const json = (await response?.json()) as unknown;
      const registration = parseRegistration(body, json);
      this.userId = registration.userId;
      this.whoUserIs = registration.whoUserIs;
      this.identity.email = emailFor(this.identity, this.userId);
    } catch (error) {
      this.captureError =
        error instanceof Error ? error : new Error(String(error));
    }
  }
}
