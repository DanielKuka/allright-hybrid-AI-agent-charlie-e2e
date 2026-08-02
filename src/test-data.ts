import { randomBytes, randomInt, randomUUID } from 'node:crypto';

import type { TestIdentity } from './types';

function letters(length: number): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz';
  return Array.from(randomBytes(length), (byte) => alphabet[byte % alphabet.length]).join('');
}

export function emailFor(identity: TestIdentity, userId?: string): string {
  const token = userId?.replace(/[^a-z0-9]/gi, '') || identity.runId;
  return `autotestUser-${token.slice(0, 48)}@example.com`;
}

export function createTestIdentity(now = new Date()): TestIdentity {
  const runId = `${now.getTime()}-${randomUUID().slice(0, 8)}`;
  const phone = `+38063${randomInt(1_000_000, 10_000_000)}`;
  const identity: TestIdentity = {
    runId,
    phone,
    phoneMasked: `${phone.slice(0, 6)}****${phone.slice(-4)}`,
    email: '',
    parentName: `QaParent${letters(8)}`,
    childName: `QaChild${letters(8)}`
  };
  identity.email = emailFor(identity);
  return identity;
}
