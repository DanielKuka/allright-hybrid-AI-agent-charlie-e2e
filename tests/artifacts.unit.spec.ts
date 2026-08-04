import { expect, test } from '@playwright/test';

import { sanitizeForArtifact } from '../src/artifacts';

test('redacts credentials and personal data while preserving experiment assignments', () => {
  const apiKey = ['sk', 'ant', 'example-secret-value'].join('-');
  const phone = ['+380', '991234567'].join('');
  const email = ['person', 'example.com'].join('@');
  const input = {
    accessToken: 'access-secret-value',
    refresh_token: 'refresh-secret-value',
    Authorization: 'Bearer bearer-secret-value',
    password: 'password-secret-value',
    message: `Authorization: Bearer embedded-secret password=embedded-password api_key=embedded-api-key ${apiKey} ${phone} ${email}`,
    experiment: { quizFlow: 'variant-b', cohort: 17 }
  };

  const serialized = JSON.stringify(sanitizeForArtifact(input));

  for (const secret of [
    'access-secret-value',
    'refresh-secret-value',
    'bearer-secret-value',
    'password-secret-value',
    'embedded-secret',
    'embedded-password',
    'embedded-api-key',
    apiKey,
    phone,
    email
  ]) {
    expect(serialized).not.toContain(secret);
  }
  expect(serialized).toContain('variant-b');
  expect(serialized).toContain('17');
});
