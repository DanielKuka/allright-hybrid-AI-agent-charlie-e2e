import { expect, test, type Page } from '@playwright/test';

import { AllRightApiClient } from '../src/allright-api-client';

test('cleanup sends the exact JSON:API PATCH contract', async () => {
  let request: unknown;
  const page = {
    evaluate: (_callback: unknown, argument: unknown) => {
      request = argument;
      return Promise.resolve({ status: 200, ok: true, body: null });
    }
  } as unknown as Page;

  await expect(
    new AllRightApiClient(page).markUserDeleted('user/852860', 'unit-credential')
  ).resolves.toEqual({ userId: 'user/852860', status: 200 });
  expect(request).toEqual({
    path:
      '/api/v1/users/user%2F852860/?fields[user]=is_deleted,deletion_reason',
    method: 'PATCH',
    headers: {
      Accept: 'application/vnd.api+json',
      'Content-Type': 'application/vnd.api+json',
      Authorization: 'Bearer unit-credential'
    },
    body: {
      data: {
        type: 'users',
        id: 'user/852860',
        attributes: {
          'is-deleted': true,
          'deletion-reason': 1
        }
      }
    }
  });
});

test('cleanup error sanitizes response credentials and PII', async () => {
  const email = ['failure', 'example.com'].join('@');
  const phone = ['+380', '631234567'].join('');
  const page = {
    evaluate: () =>
      Promise.resolve({
        status: 403,
        ok: false,
        body: {
          authorization: 'Bearer response-credential',
          email,
          message: `Rejected ${phone}`
        }
      })
  } as unknown as Page;

  let message = '';
  try {
    await new AllRightApiClient(page).markUserDeleted(
      '852860',
      'request-credential'
    );
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }

  expect(message).toContain('returned HTTP 403');
  expect(message).not.toContain('response-credential');
  expect(message).not.toContain(email);
  expect(message).not.toContain(phone);
  expect(message).toContain('[redacted-phone]');
});
