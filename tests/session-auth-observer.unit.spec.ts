import { expect, test, type Page, type Response } from '@playwright/test';

import {
  parseSessionAuth,
  SessionAuthObserver
} from '../src/session-auth-observer';

test('extracts only access_token and user_id from OAuth response', () => {
  expect(
    parseSessionAuth({
      access_token: 'unit-credential',
      refresh_token: 'ignored-refresh-value',
      token_type: 'bearer',
      user_id: 853276
    })
  ).toEqual({ accessToken: 'unit-credential', userId: '853276' });
});

test('rejects missing or empty OAuth cleanup credentials', () => {
  expect(() => parseSessionAuth({ user_id: 1 })).toThrow(
    'does not contain access_token'
  );
  expect(() => parseSessionAuth({ access_token: '   ', user_id: 1 })).toThrow(
    'returned an empty access_token'
  );
  expect(() => parseSessionAuth({ access_token: 'unit-credential' })).toThrow(
    'does not contain user_id'
  );
});

test('observer captures successful OAuth response and detaches cleanly', async () => {
  let responseListener: ((response: Response) => void) | undefined;
  const page = {
    on: (event: string, listener: (response: Response) => void) => {
      if (event === 'response') responseListener = listener;
    },
    off: (event: string, listener: (response: Response) => void) => {
      if (event === 'response' && responseListener === listener) {
        responseListener = undefined;
      }
    }
  } as unknown as Page;
  const response = {
    url: () => 'https://stage.allright.com/oauth/token',
    request: () => ({ method: () => 'POST' }),
    ok: () => true,
    json: () =>
      Promise.resolve({
        access_token: 'captured-unit-credential',
        refresh_token: 'ignored-refresh-value',
        user_id: '853276'
      })
  } as unknown as Response;
  const observer = new SessionAuthObserver('https://stage.allright.com');

  observer.start(page);
  expect(responseListener).toBeDefined();
  responseListener?.(response);

  await expect(observer.waitForSessionAuth(500)).resolves.toEqual({
    accessToken: 'captured-unit-credential',
    userId: '853276'
  });
  observer.stop();
  expect(responseListener).toBeUndefined();
  await expect(observer.waitForSessionAuth(1)).rejects.toThrow(
    'Authenticated OAuth session was not captured'
  );
});
