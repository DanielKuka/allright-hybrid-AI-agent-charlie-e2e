import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { TestInfo } from '@playwright/test';

import type {
  CleanupEvidence,
  ExperimentContext,
  FlowResult,
  StepLog,
  TestIdentity
} from './types';

const SENSITIVE_KEY =
  /authorization|cookie|email|password|phone|access.?token|refresh.?token|secret/i;
const INTERNATIONAL_PHONE = /\+\d[\d\s()-]{8,}\d/g;
const EMAIL_ADDRESS = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const BEARER_CREDENTIAL = /\bbearer\s+[^\s,;"'}]+/gi;
const ANTHROPIC_CREDENTIAL = /\bsk-ant-[A-Za-z0-9_-]+/g;
const NAMED_CREDENTIAL =
  /\b(authorization|password|access[_-]?token|refresh[_-]?token|api[_-]?key|secret)\b\s*[:=]\s*["']?[^\s,;"'}]+/gi;
const SAFE_ARTIFACT_DIR = resolve('sanitized-artifacts');

export function sanitizeForArtifact(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[truncated]';
  if (typeof value === 'string') {
    return value
      .replace(INTERNATIONAL_PHONE, (candidate) => {
        const digits = candidate.replace(/\D/g, '');
        return digits.length >= 10 && digits.length <= 15
          ? '[redacted-phone]'
          : candidate;
      })
      .replace(EMAIL_ADDRESS, '[redacted-email]')
      .replace(BEARER_CREDENTIAL, 'Bearer [redacted]')
      .replace(ANTHROPIC_CREDENTIAL, '[redacted-api-key]')
      .replace(NAMED_CREDENTIAL, '$1=[redacted]')
      .slice(0, 2_000);
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, 100)
      .map((item) => sanitizeForArtifact(item, depth + 1));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 100)
        .map(([key, item]) => [
          key,
          SENSITIVE_KEY.test(key) && !/^phoneMasked$/i.test(key)
            ? '[redacted]'
            : sanitizeForArtifact(item, depth + 1)
        ])
    );
  }
  return value;
}

function redactIdentity(value: string, identity: TestIdentity): string {
  return value
    .replaceAll(identity.phone, identity.phoneMasked)
    .replaceAll(identity.email, '[redacted-email]');
}

export function sanitizedLog(log: StepLog[], identity: TestIdentity): unknown {
  const identityRedacted = log.map((entry) => ({
    ...entry,
    action: Object.fromEntries(
      Object.entries(entry.action).map(([key, value]) => [
        key,
        typeof value === 'string' ? redactIdentity(value, identity) : value
      ])
    )
  }));
  return sanitizeForArtifact(identityRedacted);
}

async function attachJson(
  testInfo: TestInfo,
  name: string,
  value: unknown
): Promise<void> {
  const body = JSON.stringify(sanitizeForArtifact(value), null, 2);
  await testInfo.attach(name, {
    body: Buffer.from(body),
    contentType: 'application/json'
  });
  await mkdir(SAFE_ARTIFACT_DIR, { recursive: true });
  await writeFile(resolve(SAFE_ARTIFACT_DIR, `${name}.json`), body, 'utf8');
}

export async function attachArtifacts(params: {
  testInfo: TestInfo;
  identity: TestIdentity;
  log: StepLog[];
  result: FlowResult;
  cleanup: CleanupEvidence;
  experimentContext: ExperimentContext;
}): Promise<void> {
  await attachJson(
    params.testInfo,
    'agent-log',
    sanitizedLog(params.log, params.identity)
  );
  await attachJson(params.testInfo, 'business-outcome', params.result);
  await attachJson(params.testInfo, 'cleanup-status', params.cleanup);
  await attachJson(
    params.testInfo,
    'experiment-context',
    params.experimentContext
  );
}
