import type { Page, Response } from '@playwright/test';

const OAUTH_TOKEN_PATH = '/oauth/token';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export interface SessionAuth {
  accessToken: string;
  userId: string;
}

export function parseSessionAuth(value: unknown): SessionAuth {
  if (!record(value) || typeof value.access_token !== 'string') {
    throw new Error('POST /oauth/token response does not contain access_token');
  }
  const accessToken = value.access_token.trim();
  if (!accessToken) {
    throw new Error('POST /oauth/token returned an empty access_token');
  }
  const userId = value.user_id;
  if (typeof userId !== 'string' && typeof userId !== 'number') {
    throw new Error('POST /oauth/token response does not contain user_id');
  }
  return { accessToken, userId: String(userId) };
}

export class SessionAuthObserver {
  private page: Page | undefined;
  private sessionAuth: SessionAuth | undefined;
  private captureError: Error | undefined;

  constructor(private readonly expectedOrigin: string) {}

  private readonly responseListener = (response: Response): void => {
    void this.captureResponse(response);
  };

  start(page: Page): void {
    if (this.page) throw new Error('SessionAuthObserver has already been started');
    this.page = page;
    page.on('response', this.responseListener);
  }

  stop(): void {
    if (this.page) this.page.off('response', this.responseListener);
    this.page = undefined;
    this.sessionAuth = undefined;
    this.captureError = undefined;
  }

  async waitForSessionAuth(timeoutMs = 10_000): Promise<SessionAuth> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.captureError) throw this.captureError;
      if (this.sessionAuth) return this.sessionAuth;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('Authenticated OAuth session was not captured');
  }

  private async captureResponse(response: Response): Promise<void> {
    const request = response.request();
    const url = new URL(response.url());
    if (
      url.origin !== this.expectedOrigin ||
      url.pathname !== OAUTH_TOKEN_PATH ||
      request.method() !== 'POST' ||
      !response.ok()
    ) {
      return;
    }

    try {
      this.sessionAuth = parseSessionAuth(await response.json());
      this.captureError = undefined;
    } catch (error) {
      this.captureError =
        error instanceof Error ? error : new Error(String(error));
    }
  }
}
