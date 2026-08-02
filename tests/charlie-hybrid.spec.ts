import { expect, test } from '@playwright/test';

import { Agent } from '../src/agent';
import { attachArtifacts } from '../src/artifacts';
import { runNavigator } from '../src/navigator';
import { RegistrationObserver } from '../src/registration-observer';
import { createTestIdentity } from '../src/test-data';
import { FunnelOutcome } from '../src/types';
import { Verifier } from '../src/verifier';

const START_PATH = '/uk/app/sign-up/long/charlie/age-range';
const ACCEPTED_OUTCOMES = [
  FunnelOutcome.BOOKED,
  FunnelOutcome.LEAD_CREATED
] as const;

test('AI agent completes Charlie funnel and deterministic verifier confirms the outcome', async ({
  page
}, testInfo) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured');

  const identity = createTestIdentity();
  const observer = new RegistrationObserver(identity);
  observer.attach(page);

  await page.goto(START_PATH);
  const { outcome, log } = await runNavigator(
    page,
    new Agent(apiKey, identity),
    () => observer.snapshot.lessonMutationSucceeded
  );
  const result = await new Verifier().confirm({
    page,
    observer,
    navigatorOutcome: outcome
  });
  await attachArtifacts({ testInfo, identity, log, result });

  testInfo.annotations.push({
    type: 'business-outcome',
    description: `${result.outcome}: ${result.reason}`
  });
  console.log(
    `Business outcome: ${result.outcome} — ${result.reason}; agent steps: ${log.length}`
  );

  expect(ACCEPTED_OUTCOMES, `${result.outcome}: ${result.reason}`).toContain(
    result.outcome
  );
});
