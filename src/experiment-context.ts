import type { Page } from '@playwright/test';

import type { ExperimentContext } from './types';

export function parseExperimentValue(value: string | undefined): unknown {
  if (value === undefined || value === '') return null;

  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // Preserve malformed or plain values as diagnostic strings.
  }

  try {
    return JSON.parse(decoded) as unknown;
  } catch {
    return decoded;
  }
}

export async function readExperimentContext(
  page: Page
): Promise<ExperimentContext> {
  const cookies = await page
    .context()
    .cookies(page.url())
    .catch(() => []);
  const localStorageValue = await page
    .evaluate(() => localStorage.getItem('experiments'))
    .catch(() => null);
  const cookie = cookies.find((item) => item.name === 'experiments');

  return {
    httpAssignment: parseExperimentValue(cookie?.value),
    storageAssignment: parseExperimentValue(localStorageValue ?? undefined)
  };
}
