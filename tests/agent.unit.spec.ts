import { expect, test } from '@playwright/test';

import { Agent } from '../src/agent';
import type { TestIdentity } from '../src/types';

function identity(): TestIdentity {
  return {
    runId: 'offline-run',
    phone: '+380630000001',
    phoneMasked: '+38063****0001',
    email: 'offline@example.com',
    parentName: 'QaParentoffline',
    childName: 'QaChildoffline'
  };
}

function mockCreate(
  agent: Agent,
  responseInput: Record<string, unknown> | null,
  captured: unknown[] = []
): void {
  const internal = agent as unknown as {
    client: {
      messages: {
        create: (params: unknown) => Promise<unknown>;
      };
    };
  };
  internal.client.messages.create = (params: unknown) => {
    captured.push(params);
    return Promise.resolve(
      responseInput === null
        ? { content: [{ type: 'text', text: 'no tool call' }] }
        : {
            content: [
              { type: 'tool_use', name: 'next_action', input: responseInput }
            ]
          }
    );
  };
}

test('preserves working tool-use action parsing', async () => {
  const agent = new Agent('fake-key', identity());
  mockCreate(agent, {
    observed: 'Кнопка Далі активна',
    reason: 'Інформаційний слайд',
    type: 'click',
    selector: 'role=button[name="Далі"]'
  });

  const action = await agent.nextAction('button "Далі" 9/21', []);
  expect(action).toEqual({
    observed: 'Кнопка Далі активна',
    type: 'click',
    selector: 'role=button[name="Далі"]',
    reason: 'Кнопка Далі активна → Інформаційний слайд'
  });
});

test('falls back to stuck when model does not call the tool', async () => {
  const agent = new Agent('fake-key', identity());
  mockCreate(agent, null);
  const action = await agent.nextAction('snapshot', []);
  expect(action.type).toBe('stuck');
  expect(action.reason).toContain('Модель не викликала tool');
});

test('keeps temperature, forced tool and progress/history grounding', async () => {
  const agent = new Agent('fake-key', identity());
  const captured: unknown[] = [];
  mockCreate(
    agent,
    {
      observed: 'A',
      reason: 'B',
      type: 'click',
      selector: 'role=button[name="A"]'
    },
    captured
  );
  await agent.nextAction('SNAPSHOT_MARKER 5/21', [
    {
      type: 'click',
      selector: 'role=button[name="Прийняти все"]',
      reason: 'cookie'
    }
  ]);

  const params = captured[0] as {
    temperature: number;
    tool_choice: unknown;
    messages: Array<{ content: string }>;
  };
  expect(params.temperature).toBe(0);
  expect(params.tool_choice).toEqual({ type: 'tool', name: 'next_action' });
  expect(params.messages[0]?.content).toContain('SNAPSHOT_MARKER 5/21');
  expect(params.messages[0]?.content).toContain('Прийняти все');
  expect(params.messages[0]?.content).toContain('Current step progress: 5/21');
});
