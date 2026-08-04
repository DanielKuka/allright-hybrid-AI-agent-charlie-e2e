# Charlie quiz hybrid v2

[![Safe CI](https://github.com/DanielKuka/allright-hybrid-AI-agent-charlie-e2e/actions/workflows/ci.yml/badge.svg)](https://github.com/DanielKuka/allright-hybrid-AI-agent-charlie-e2e/actions/workflows/ci.yml)

Невелике рішення тестового завдання на Playwright/TypeScript.

## Обраний варіант Частини B

**Варіант 2 — AI-driven прохід квіза з детермінованим підтвердженням
результату.**

V2 свідомо зберігає runtime перевіреного AI-проєкту:

- повний `body.ariaSnapshot()`;
- Claude Haiku, `temperature: 0`, forced tool call;
- останні 5 дій і progress marker;
- правило діяти на найновішому/останньому блоці accumulated DOM;
- `SETTLE_DELAY=1500ms`, `MAX_STEPS=40`, без navigation retry.

Навколо нього додано мінімальний deterministic контур:

- спостереження реального `POST /api/v1/users` і `data.id`;
- різні letters-only parent/child names;
- email `autotestUser-{userId}@example.com`, run ID як fallback;
- `BOOKED`, `LEAD_CREATED`, `FAILED`;
- balances + tri-state `ACTIVE`/`INACTIVE`/`INDETERMINATE` lesson verification
  у поточній browser session;
- OAuth response observer і автоматичний cleanup кожного створеного user;
- best-effort diagnostics A/B assignment із cookie/localStorage `experiments`;
- постійний Playwright guard для `popup-leaving-page`, який може з'явитися
  між AI snapshot і виконанням дії;
- terminal UI/network/backend evidence має пріоритет над рішенням AI зі
  snapshot, який міг застаріти під час model latency;
- зміна route або progress під час model latency відкидає стару AI-дію без її
  повторного виконання й бере свіжий snapshot;
- selector AI звіряється з поточним accessibility snapshot; для
  незаземленої дії дозволений один correction call без UI side effect;
- санітизовані agent/business/cleanup/experiment artifacts, без
  trace/screenshot/video.

AI тут вирішує лише, як пройти мінливі quiz steps. Він не є джерелом business
truth: registration, terminal route, balance, активний майбутній урок і cleanup
перевіряються детермінованим кодом.

Письмова Частина A: [APPROACH.md](APPROACH.md).

## Встановлення

Потрібен Node.js 20+.

```bash
npm install
npx playwright install chromium
cp .env.example .env
```

Локальний `.env` містить тільки:

```dotenv
ANTHROPIC_API_KEY=your-real-key
STAGE_BASE_URL=https://stage.allright.com
```

Окремий OAuth secret не потрібен. Access token і `user_id` перехоплюються з
відповіді поточного `POST /oauth/token`, живуть лише в пам'яті до cleanup і не
записуються в result, logs або artifacts. `.env` виключений із Git.

## Локальні перевірки без side effects

```bash
npm run typecheck
npm run test:unit
npm run test:browser-contract
# або все разом
npm run check
```

Команда не звертається до Anthropic або stage.

## Live-запуск

Headed, щоб бачити flow:

```bash
npm run test:e2e:headed
```

Headless-команда для контрольованого CI:

```bash
npm run test:e2e
```

Live-тест створює реального stage-користувача і за наявності слотів може
забронювати урок. Після business verification він завжди намагається видалити
створеного user. Один worker, без retry.

## Cleanup lifecycle

Registration observer запам'ятовує `data.id`, а OAuth observer — `user_id` і
тимчасовий access token. У `finally` обидва ID обов'язково звіряються. Лише
після збігу виконується authenticated JSON:API `PATCH` із
`is-deleted: true` та `deletion-reason: 1`.

- `DELETED` — cleanup успішний;
- `NOT_REQUIRED` — user не був створений;
- `FAILED` — user створено, але видалення не підтверджено.

Product failure не маскується успішним cleanup. І навпаки, успішний `BOOKED`
або `LEAD_CREATED` із cleanup `FAILED` робить live test червоним. Видалення user
на stage каскадно скасовує його майбутній урок.

## Pass criteria

- `BOOKED`: trial balance має `lessons-scheduled >= 1`, а filtered lessons —
  позитивний evidence активного майбутнього уроку цього user;
- `LEAD_CREATED`: `POST /users` підтверджено, terminal route —
  `/request-gotten`;

`request-gotten` не називається бронюванням: подальший контакт менеджера лежить
за межами автоматизації.

## GitHub Actions

- **Safe CI** запускається на push у `main` та pull request: typecheck, unit і
  browser-contract tests. Він не звертається до stage чи Anthropic, не створює
  user і не потребує secrets.
- **Manual Stage E2E** запускається тільки через **Run workflow** після
  обов'язкового checkbox про side effects. Потрібен GitHub Secret
  `ANTHROPIC_API_KEY`; окремий OAuth secret не потрібен. Workflow має один
  worker, no retry, concurrency one та завантажує на failure лише попередньо
  санітизовані artifacts.

Cleanup зменшує side effect, але не скасовує його факт: user спочатку реально
створюється і може забронювати урок.

## Припущення й межі

- AI може помилитися або повторити старий accumulated-DOM крок. Selector поза
  поточним snapshot отримує один correction call; повторна hallucination або
  grounded, але невиконувана дія чесно повертає `stuck`.
- Телефон, email та імена передаються Anthropic у system prompt, бо модель має
  заповнювати ці поля. Використовуються лише синтетичні дані.
- Випадковий український номер повинен бути замінений зарезервованим тестовим
  range, якщо команда його надасть.
- Нова принципово інша interaction semantics може потребувати prompt/code
  зміни; нові тексти, порядок і звичайні controls — ні.
- LLM додає latency, cost, nondeterminism і залежність від availability
  Anthropic, тому його рішення не використовується як business assertion.

## Що зробив би далі

- зарезервований phone range;
- success-rate метрика агента окремо від product outcome;
- sanitized replay corpus реальних A/B snapshots;
- контрольований retry лише для transient Anthropic/network errors;
- окрема метрика частки `BOOKED` і `LEAD_CREATED`.
