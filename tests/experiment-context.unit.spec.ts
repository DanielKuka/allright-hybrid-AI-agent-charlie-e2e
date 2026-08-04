import { expect, test, type Page } from '@playwright/test';

import {
  parseExperimentValue,
  readExperimentContext
} from '../src/experiment-context';

test('parses JSON, URI-encoded JSON, plain string and missing assignments', () => {
  expect(parseExperimentValue('{"quiz":"variant-a"}')).toEqual({
    quiz: 'variant-a'
  });
  expect(
    parseExperimentValue('%7B%22booking%22%3A%22slots%22%7D')
  ).toEqual({ booking: 'slots' });
  expect(parseExperimentValue('opaque-variant')).toBe('opaque-variant');
  expect(parseExperimentValue(undefined)).toBeNull();
  expect(parseExperimentValue('')).toBeNull();
});

test('captures cookie and localStorage experiment context without assertions', async () => {
  const page = {
    url: () => 'https://stage.allright.com/uk/app/request-gotten',
    context: () => ({
      cookies: () =>
        Promise.resolve([
          {
            name: 'experiments',
            value: '%7B%22quiz%22%3A%22b%22%7D'
          }
        ])
    }),
    evaluate: () => Promise.resolve('{"booking":"slots"}')
  } as unknown as Page;

  await expect(readExperimentContext(page)).resolves.toEqual({
    httpAssignment: { quiz: 'b' },
    storageAssignment: { booking: 'slots' }
  });
});

test('experiment diagnostics are best-effort when browser storage is unavailable', async () => {
  const page = {
    url: () => 'about:blank',
    context: () => ({
      cookies: () => Promise.reject(new Error('cookies unavailable'))
    }),
    evaluate: () => Promise.reject(new Error('storage unavailable'))
  } as unknown as Page;

  await expect(readExperimentContext(page)).resolves.toEqual({
    httpAssignment: null,
    storageAssignment: null
  });
});
