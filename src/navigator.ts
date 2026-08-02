import type { Page } from '@playwright/test';

import { Agent } from './agent';
import {
  actionTargetsVisiblePopup,
  installPopupGuard,
  popupGuardCheckpoint
} from './popup-guard';
import type { AgentAction, NavigatorOutcome, StepLog } from './types';

export const MAX_STEPS = 40;
export const STEP_TIMEOUT = 10_000;
export const TOTAL_TIMEOUT = 220_000;
const SETTLE_DELAY = 1_500;

type ExecutableAction = Extract<
  AgentAction,
  { type: 'click' | 'fill' | 'select' | 'dismiss' }
>;

export async function runNavigator(
  page: Page,
  agent: Agent,
  stopWhen?: () => boolean
): Promise<{ outcome: NavigatorOutcome; log: StepLog[] }> {
  const log: StepLog[] = [];
  const history: AgentAction[] = [];
  const startedAt = Date.now();

  await installPopupGuard(page, () => {
    console.log('PopupGuard: transient booking popup dismissed');
  });

  for (let step = 1; step <= MAX_STEPS; step += 1) {
    if (Date.now() - startedAt > TOTAL_TIMEOUT) {
      return {
        outcome: {
          status: 'timeout',
          reason: `Перевищено TOTAL_TIMEOUT=${TOTAL_TIMEOUT}ms`
        },
        log
      };
    }
    if (stopWhen?.()) {
      return {
        outcome: {
          status: 'done',
          reason: 'Зупинено достроково: умова stopWhen досягнута'
        },
        log
      };
    }

    await popupGuardCheckpoint(page);
    const snapshot = await page.locator('body').ariaSnapshot();
    const action = await agent.nextAction(snapshot, history);
    history.push(action);
    log.push({ step, action, timestamp: new Date().toISOString() });

    // Product state may advance while the AI is interpreting an older
    // snapshot. Deterministic network evidence wins over that stale decision.
    if (stopWhen?.()) {
      return {
        outcome: {
          status: 'done',
          reason: 'Зупинено: під час AI-виклику отримано terminal network evidence'
        },
        log
      };
    }

    if (action.type === 'done' || action.type === 'stuck') {
      return { outcome: { status: action.type, reason: action.reason }, log };
    }

    try {
      // If the popup was present in the snapshot, dismissing it completes the
      // agent's modal-related action. Do not click a now-detached close/CTA.
      const targetsPopup = await actionTargetsVisiblePopup(
        page,
        action.selector
      );
      if (targetsPopup) {
        await popupGuardCheckpoint(page);
        await page.waitForTimeout(SETTLE_DELAY);
        continue;
      }

      await executeAction(page, action);
      await page.waitForTimeout(SETTLE_DELAY);
      if (stopWhen?.()) {
        return {
          outcome: {
            status: 'done',
            reason: 'Зупинено: після дії отримано terminal network evidence'
          },
          log
        };
      }
    } catch (error) {
      return {
        outcome: {
          status: 'stuck',
          reason: `Дія "${action.type}" на "${action.selector}" провалилась: ${
            error instanceof Error ? error.message : String(error)
          }`
        },
        log
      };
    }
  }

  return {
    outcome: { status: 'stuck', reason: `Вичерпано MAX_STEPS=${MAX_STEPS}` },
    log
  };
}

async function executeAction(page: Page, action: ExecutableAction): Promise<void> {
  const locator = page.locator(action.selector).first();
  switch (action.type) {
    case 'click':
    case 'dismiss':
      await locator.click({ timeout: STEP_TIMEOUT });
      return;
    case 'fill':
      await locator.fill(action.value, { timeout: STEP_TIMEOUT });
      return;
    case 'select':
      await locator.selectOption(action.value, { timeout: STEP_TIMEOUT });
  }
}
