import { expect, test } from '@playwright/test';

import type { Agent } from '../src/agent';
import { runNavigator } from '../src/navigator';
import type { AgentAction } from '../src/types';

test('discards an AI action when progress advances during model latency', async ({
  page
}) => {
  await page.setContent(`
    <div>19 / 21</div>
    <input placeholder="+380 50 123 4567" />
  `);

  let calls = 0;
  const agent = {
    async nextAction(): Promise<AgentAction> {
      calls += 1;
      if (calls === 1) {
        await page.setContent(`
          <div>20 / 21</div>
          <input placeholder="Ваш е-mail" />
        `);
        return {
          type: 'click',
          selector: '[placeholder="+380 50 123 4567"]',
          reason: 'stale phone-screen action'
        };
      }
      return { type: 'done', reason: 'fresh email-screen decision' };
    }
  } as unknown as Agent;

  const result = await runNavigator(page, agent);

  expect(result.outcome).toEqual({
    status: 'done',
    reason: 'fresh email-screen decision'
  });
  expect(result.log).toHaveLength(2);
  expect(calls).toBe(2);
});
