import { expect, test } from '@playwright/test';

import { Agent } from '../src/agent';
import { AllRightApiClient } from '../src/allright-api-client';
import { attachArtifacts, sanitizeForArtifact } from '../src/artifacts';
import { readExperimentContext } from '../src/experiment-context';
import { cleanupCreatedUser, evaluateLifecycle } from '../src/lifecycle';
import { runNavigator } from '../src/navigator';
import { RegistrationObserver } from '../src/registration-observer';
import { SessionAuthObserver } from '../src/session-auth-observer';
import { createTestIdentity } from '../src/test-data';
import type {
  CleanupEvidence,
  ExperimentContext,
  FlowResult,
  StepLog
} from '../src/types';
import { FunnelOutcome } from '../src/types';
import { Verifier } from '../src/verifier';

const START_PATH = '/uk/app/sign-up/long/charlie/age-range';

test('AI agent completes Charlie funnel and deterministic verifier confirms the outcome', async ({
  page
}, testInfo) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured');

  const identity = createTestIdentity();
  const registrationObserver = new RegistrationObserver(identity);
  const stageOrigin = new URL(
    process.env.STAGE_BASE_URL ?? 'https://stage.allright.com'
  ).origin;
  const sessionAuthObserver = new SessionAuthObserver(stageOrigin);
  let log: StepLog[] = [];
  let result: FlowResult = {
    outcome: FunnelOutcome.FAILED,
    reason: 'Flow did not complete',
    terminalUrl: page.url()
  };
  let cleanup: CleanupEvidence = { status: 'NOT_REQUIRED' };
  let experimentContext: ExperimentContext = {
    httpAssignment: null,
    storageAssignment: null
  };

  registrationObserver.start(page);
  sessionAuthObserver.start(page);

  try {
    await page.goto(START_PATH);
    const navigation = await runNavigator(
      page,
      new Agent(apiKey, identity),
      () => registrationObserver.snapshot.lessonMutationSucceeded
    );
    log = navigation.log;
    result = await new Verifier().confirm({
      page,
      observer: registrationObserver,
      navigatorOutcome: navigation.outcome
    });
  } catch (error) {
    const captured = registrationObserver.snapshot;
    result = {
      outcome: FunnelOutcome.FAILED,
      reason: error instanceof Error ? error.message : String(error),
      terminalUrl: page.url(),
      ...(captured.userId ? { userId: captured.userId } : {}),
      ...(captured.whoUserIs ? { whoUserIs: captured.whoUserIs } : {})
    };
  } finally {
    try {
      experimentContext = await readExperimentContext(page).catch(() => ({
        httpAssignment: null,
        storageAssignment: null
      }));
      cleanup = await cleanupCreatedUser({
        registrationObserver,
        sessionAuthObserver,
        apiClient: new AllRightApiClient(page)
      });
    } finally {
      registrationObserver.stop();
      sessionAuthObserver.stop();
    }
  }

  await attachArtifacts({
    testInfo,
    identity,
    log,
    result,
    cleanup,
    experimentContext
  });

  testInfo.annotations.push({
    type: 'business-outcome',
    description: result.outcome
  });
  testInfo.annotations.push({
    type: 'cleanup',
    description: cleanup.status
  });
  const safeReason = sanitizeForArtifact(result.reason);
  console.log(`Business outcome: ${result.outcome}`);
  console.log(`Business reason: ${String(safeReason)}; agent steps: ${log.length}`);
  console.log(`Cleanup status: ${cleanup.status}`);

  const userCreated =
    registrationObserver.snapshot.registrationSucceeded || Boolean(result.userId);
  const verdict = evaluateLifecycle({ result, cleanup, userCreated });
  expect(verdict.failures, verdict.failures.join('\n')).toEqual([]);
});
