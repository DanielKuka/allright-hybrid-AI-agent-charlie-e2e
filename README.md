# Charlie quiz hybrid v2

[![Charlie hybrid v2](https://github.com/DanielKuka/allright-hybrid-AI-agent-charlie-e2e/actions/workflows/charlie-hybrid.yml/badge.svg)](https://github.com/DanielKuka/allright-hybrid-AI-agent-charlie-e2e/actions/workflows/charlie-hybrid.yml)

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
- balances + filtered lessons verification у поточній browser session;
- постійний Playwright guard для `popup-leaving-page`, який може з'явитися
  між AI snapshot і виконанням дії;
- terminal UI/network/backend evidence має пріоритет над рішенням AI зі
  snapshot, який міг застаріти під час model latency;
- selector AI звіряється з поточним accessibility snapshot; для
  незаземленої дії дозволений один correction call без UI side effect;
- санітизовані agent artifacts, без trace/screenshot/video.

Письмова Частина A: [APPROACH.md](APPROACH.md).

## Встановлення

Потрібен Node.js 20+.

```bash
npm install
npx playwright install chromium
cp .env.example .env
```

У `.env` обов'язковий тільки:

```dotenv
ANTHROPIC_API_KEY=your-real-key
```

OAuth Basic Auth не потрібен: verifier використовує авторизовану browser
session. `.env` виключений із Git.

## Локальні перевірки без side effects

```bash
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
забронювати урок. Один worker, без retry.

## Pass criteria

- `BOOKED`: trial balance має `lessons-scheduled >= 1`, а filtered lessons —
  щонайменше один запис;
- `LEAD_CREATED`: `POST /users` підтверджено, terminal route —
  `/request-gotten`;

`request-gotten` не називається бронюванням: подальший контакт менеджера лежить
за межами автоматизації.

## Припущення й межі

- AI може помилитися або повторити старий accumulated-DOM крок. Selector поза
  поточним snapshot отримує один correction call; повторна hallucination або
  grounded, але невиконувана дія чесно повертає `stuck`.
- Телефон, email та імена передаються Anthropic у system prompt, бо модель має
  заповнювати ці поля. Використовуються лише синтетичні дані.
- Випадковий український номер повинен бути замінений зарезервованим тестовим
  range, якщо команда його надасть.
- Cleanup не реалізований без документованого endpoint.
- Нова принципово інша interaction semantics може потребувати prompt/code
  зміни; нові тексти, порядок і звичайні controls — ні.

## Що зробив би далі

- зарезервований phone range і cleanup job;
- success-rate метрика агента окремо від product outcome;
- sanitized replay corpus реальних A/B snapshots;
- контрольований retry лише для transient Anthropic/network errors;
- окрема метрика частки `BOOKED` і `LEAD_CREATED`.
