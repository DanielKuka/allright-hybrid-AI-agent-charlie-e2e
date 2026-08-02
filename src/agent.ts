import Anthropic from '@anthropic-ai/sdk';

import type { AgentAction, TestIdentity } from './types';

const MODEL = 'claude-haiku-4-5-20251001';
const TEMPERATURE = 0;
const TOOL_NAME = 'next_action';

const NEXT_ACTION_TOOL: Anthropic.Tool = {
  name: TOOL_NAME,
  description:
    'Report what is currently on screen, then choose exactly one next action to perform on the page.',
  input_schema: {
    type: 'object',
    properties: {
      observed: {
        type: 'string',
        description:
          'What the CURRENT snapshot shows right now: the active step heading/progress, and the enabled controls you can act on. State only what is literally in this snapshot.'
      },
      reason: {
        type: 'string',
        description:
          'Why this action follows from what you just observed and from the rules. Reference the observed state, not earlier steps.'
      },
      type: {
        type: 'string',
        enum: ['click', 'fill', 'select', 'dismiss', 'done', 'stuck'],
        description: 'The action kind.'
      },
      selector: {
        type: 'string',
        description:
          'Playwright locator for click/fill/select/dismiss. Omit for done/stuck.'
      },
      value: {
        type: 'string',
        description: 'Value for fill/select. Omit for other action kinds.'
      }
    },
    required: ['observed', 'reason', 'type']
  }
};

function buildSystemPrompt(identity: TestIdentity): string {
  return `You are a test agent walking through a child English-lesson signup funnel (All Right, "charlie" funnel) on a staging environment.

The product UI is in Ukrainian. Snapshots, button names and headings will be Ukrainian — that is expected. Your reasoning and tool input are in English.

## Persona

You are a parent registering YOUR CHILD for a trial lesson.

If the quiz asks who is filling in the form / who you are, always pick the option meaning "I am the mother or father". NEVER pick the "I am a child" option, even if the wording differs from this example.

The child's age is deliberately NOT fixed by this persona. If the quiz asks for an age (as a number, a range, or any other format), pick any option that is technically valid for a school-age or preschool-age child. The age never influences any other decision in this run.

Field data, if the quiz asks for it:
- parent's name: ${identity.parentName}
- child's name: ${identity.childName}
- phone: ${identity.phone}
- email: ${identity.email}

## CRITICAL INVARIANTS — these always apply, on every single step

**I1. Selector format.** Every snapshot line looks like: role "name" (e.g. \`button "Далі"\`). That is an ARIA role and an ARIA name, NOT necessarily visible text.

Build every selector with this exact template:

\`\`\`
role=<role>[name="<name>"]
\`\`\`

Example: \`button "Далі"\` → \`role=button[name="Далі"]\`

The literal \`role=\` prefix is MANDATORY. Without it the string is parsed as invalid CSS instead of a role locator and the action always fails. This works for buttons with visible text AND for icon-only controls where \`:has-text()\` would not match anything.

Role names in the snapshot (textbox, generic, button, dialog…) are ARIA roles, not HTML tags — never use them as a CSS tag. For a text field with a visible placeholder use an attribute selector with no tag: \`[placeholder="Ім'я дитини"]\`, NOT \`textbox[placeholder=...]\`.

Use \`text=\` only for plain text outside buttons and fields (e.g. a link).

**I2. The current snapshot is the only source of truth.** The action history is a log of what has already been done, to avoid repeats — nothing more. If anything in the history conflicts with what the current snapshot shows, the snapshot wins. Never act on an element because it was there on a previous step.

**I3. Never act on a disabled element.** If the snapshot marks a control \`[disabled]\`, it is not clickable and clicking it will time out. A disabled primary button means a precondition is not satisfied yet — satisfy that precondition first.

**I4. The page accumulates steps.** This funnel does NOT replace the screen on each step — earlier, already-answered questions stay mounted in the DOM, so the snapshot may contain several question blocks at once. Act ONLY on the newest / last block in the snapshot. Ignore headings, options and buttons that appear above it — those belong to questions that were already answered.

**I5. No semantic justification for mechanical choices.** When the rules below already describe how to choose, decide purely from the snapshot state and the literal rule. Do NOT invent a rationale from earlier quiz answers.

## Situational rules

- **Cookie banner** ("Ми дбаємо про вашу конфіденційність", buttons "Прийняти все" / "Відхилити все"): dismiss it with "Прийняти все" the FIRST time you see it, even if it does not visually block the control you want.

- **Modal / popup / overlay** on top of the main content: dismiss it first. An element with role \`dialog\` is such a popup, even if it carries a call to action like "Завершити бронювання". Close it with its close control; do not interact with content underneath while it is open.

- **Informational slide.** If the newest block has only ONE action button (e.g. just "Далі") and no answer options, it is an informational slide, not a question — even if its heading echoes the question you just answered. Click the button that is actually present in this snapshot; do not repeat the previous step's answer.

- **Phone field.** Do NOT click the country selector and do NOT open the country list. Just \`fill\` the full number including the international code (\`${identity.phone}\`) straight into the phone text field.

- **Lesson time screen.** Reaching this screen is the product guarantee that a free slot exists. The product initially selects/highlights a time-of-day period that contains an enabled time button. Pick any enabled time in THAT already-selected period and then press the booking confirmation button. Do NOT switch or enumerate the morning/day/evening periods.

- **Selecting a time is not booking.** Choosing a date, a period or a specific time is only a selection. The booking screen always has a separate confirmation button that must be clicked explicitly.

## Exit conditions

- \`done\` — only after you see the page that follows confirmation (dashboard, success message, request-received screen). Never return \`done\` merely because a time looks selected.
- \`stuck\` — you cannot tell what to do next.

Call the \`${TOOL_NAME}\` tool exactly once with your decision. Do not write anything outside the tool call.`;
}

export class Agent {
  private readonly client: Anthropic;
  private readonly progressLog: string[] = [];

  constructor(
    apiKey: string,
    private readonly identity: TestIdentity
  ) {
    this.client = new Anthropic({ apiKey });
  }

  async nextAction(snapshot: string, history: AgentAction[]): Promise<AgentAction> {
    this.progressLog.push(extractProgress(snapshot));
    const windowSize = 5;
    const start = Math.max(0, history.length - windowSize);
    const historyText = history.length
      ? history
          .slice(start)
          .map((action, offset) => {
            const index = start + offset;
            const at = this.progressLog[index] ?? '?';
            const target = 'selector' in action ? ` [${action.selector}]` : '';
            return `${index + 1}. (at ${at}) ${action.type}${target}`;
          })
          .join('\n')
      : '(no actions yet)';
    const currentProgress = this.progressLog[this.progressLog.length - 1];

    const response = await this.client.messages.create({
      model: MODEL,
      max_tokens: 700,
      temperature: TEMPERATURE,
      system: buildSystemPrompt(this.identity),
      tools: [NEXT_ACTION_TOOL],
      tool_choice: { type: 'tool', name: TOOL_NAME },
      messages: [
        {
          role: 'user',
          content: [
            `Current step progress: ${currentProgress}`,
            '',
            'Page snapshot (accessibility tree):',
            snapshot,
            '',
            'Actions already performed (with the step they were taken at):',
            historyText,
            '',
            'If the progress above is unchanged from the last entries in the history, the page did NOT advance — re-read the snapshot before deciding.',
            '',
            'Choose the next action.'
          ].join('\n')
        }
      ]
    });

    return parseToolAction(response);
  }
}

export function extractProgress(snapshot: string): string {
  const match = snapshot.match(/\b(\d{1,2})\s*\/\s*(\d{1,2})\b/);
  return match ? `${match[1]}/${match[2]}` : 'unknown';
}

export function parseToolAction(response: Anthropic.Message): AgentAction {
  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock =>
      block.type === 'tool_use' && block.name === TOOL_NAME
  );
  if (!toolUse) {
    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join(' ');
    return {
      type: 'stuck',
      reason: `Модель не викликала tool ${TOOL_NAME}: ${text.slice(0, 200)}`
    };
  }

  const input = toolUse.input as {
    observed?: string;
    reason?: string;
    type?: string;
    selector?: string;
    value?: string;
  };
  const reason = [input.observed?.trim(), input.reason?.trim()]
    .filter(Boolean)
    .join(' → ');
  return {
    ...input,
    reason: reason || 'no reason provided'
  } as AgentAction;
}
