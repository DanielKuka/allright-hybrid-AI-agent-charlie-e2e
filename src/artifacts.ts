import type { TestInfo } from '@playwright/test';

import type { FlowResult, StepLog, TestIdentity } from './types';

function redact(value: string, identity: TestIdentity): string {
  return value
    .replaceAll(identity.phone, identity.phoneMasked)
    .replaceAll(identity.email, '[redacted-email]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .replace(/\+\d[\d\s()-]{8,}\d/g, '[redacted-phone]');
}

export function sanitizedLog(log: StepLog[], identity: TestIdentity): unknown {
  return log.map((entry) => ({
    ...entry,
    action: Object.fromEntries(
      Object.entries(entry.action).map(([key, value]) => [
        key,
        typeof value === 'string' ? redact(value, identity) : value
      ])
    )
  }));
}

export async function attachArtifacts(params: {
  testInfo: TestInfo;
  identity: TestIdentity;
  log: StepLog[];
  result: FlowResult;
}): Promise<void> {
  await params.testInfo.attach('agent-log', {
    body: Buffer.from(JSON.stringify(sanitizedLog(params.log, params.identity), null, 2)),
    contentType: 'application/json'
  });
  await params.testInfo.attach('business-outcome', {
    body: Buffer.from(JSON.stringify(params.result, null, 2)),
    contentType: 'application/json'
  });
}
