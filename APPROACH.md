# Частина A — підхід

## Що є стабільним у мінливому квізі

Тексти, порядок і кількість екранів Charlie не є контрактом. Контрактом є:

1. користувач може пройти один із дозволених шляхів UI;
2. `POST /api/v1/users` створює акаунт і повертає `data.id`;
3. funnel завершується спостережуваним terminal outcome;
4. бронювання, якщо воно відбулося, підтверджується backend-даними.

Тому тест не має Page Object на кожне питання і не очікує фіксований route
chain.

## Що перевіряти детерміновано

- реальний registration boundary, а не лише appearance phone screen;
- `userId` із відповіді продукту;
- унікальність test data;
- terminal outcome taxonomy;
- trial balance через `TutorType.alias === "trial"`;
- `lessons-scheduled >= 1` разом із позитивним evidence активного майбутнього
  filtered lesson;
- обов'язковий lifecycle cleanup створеного user;
- ліміти кроків/часу та відсутність автоматичного live retry;
- redaction artifacts.

Це факти, які визначають бізнес-результат і не потребують інтерпретації LLM.

## Що віддати AI

- розуміння нових українських формулювань;
- вибір відповіді на новому або переставленому кроці;
- informational slides і cookie variations;
- мінливу presentation вибору дати, періоду й часу.

Accessibility snapshot кращий за screenshot для цього proof of concept: він
дає ролі, names, disabled state й компактніший за vision input. Prompt явно
враховує accumulated DOM і наказує діяти лише на останньому блоці.

Перед виконанням selector моделі звіряється з тим самим snapshot. Якщо роль і
name у ньому відсутні, UI-дія не виконується, а модель отримує один correction
call із явною причиною відхилення. Друга незаземлена відповідь повертає
`stuck`; це обмежена перевірка grounding, а не navigation retry.

Відомий `popup-leaving-page` є асинхронною механічною перешкодою, а не
семантичним кроком квіза. Його обробляє Playwright locator handler перед
snapshot і під час actionability retry. Тому popup, що виник поки Anthropic
формував відповідь, не робить рішення моделі застарілим і не натискає CTA
«Завершити бронювання».

Так само navigation або `POST /lessons` можуть завершитися, поки модель ще
аналізує попередній booking-screen snapshot. У цьому конфлікті terminal route,
успішна lesson mutation і backend evidence мають пріоритет над `stuck` від AI.
Це не маскує agent failure: `BOOKED` усе одно вимагає trial balance,
`lessons-scheduled >= 1` і tri-state lesson evidence `ACTIVE`. Порожній,
скасований, неактивний або минулий урок має `INACTIVE`; непорожня невідома
схема — `INDETERMINATE`. Жоден із них не дає `BOOKED`.

Проміжний екран також може просунутися під час model latency. Якщо після
відповіді AI змінився route або progress marker, дія зі старого snapshot не
виконується і цикл бере новий snapshot. Це відкидання stale decision, а не
повтор попередньої UI-дії.

## Що не фіксувати

- точний step count і порядок питань;
- повні тексти маркетингових screens;
- конкретну дату, слот або tutor type ID;
- pixel snapshots;
- manager contact після `/request-gotten`;
- analytics events як основний pass criterion.

Такі assertions робили б валідний A/B-тест червоним.

## Як переживаються зміни

Новий текст, порядок, кількість екранів або стандартний button/input не
потребують нового selector у репозиторії: рішення формується зі свіжого
accessibility tree. Видалення кроку також не впливає на flow, бо немає жорсткої
послідовності.

Нова interaction semantics — canvas, drag-and-drop, custom inaccessible
calendar — є зміною контракту й може вимагати нового tool/правила. У такому
випадку тест має чесно повернути `stuck`, а не приховати проблему нескінченним
self-healing.

## CI/CD

Safe CI на push у `main` і pull request:

- typecheck;
- mock agent contract tests;
- parser/redaction tests;
- без Anthropic і без створення stage users.

Manual Stage E2E:

- лише вручну через `Run workflow`, без schedule і PR trigger;
- live job починається лише після обов'язкового checkbox про створення user,
  можливе бронювання і automatic cleanup;
- один worker, concurrency one;
- no retry;
- API key лише як GitHub Secret;
- failure artifacts лише після sanitization;
- окремо рахувати agent failures і product business outcomes.

## Cleanup і credentials

OAuth observer встановлюється до першої navigation та перехоплює лише
`access_token` і `user_id` з успішного `POST /oauth/token`. Token існує лише в
пам'яті до cleanup. Registration `data.id` незалежно звіряється з OAuth
`user_id`; mismatch забороняє destructive PATCH.

Cleanup працює у `finally` після business verification для `BOOKED`,
`LEAD_CREATED` і всіх failure paths. Успішний PATCH дає `DELETED`, відсутність
створеного user — `NOT_REQUIRED`, а неможливість видалення створеного user —
`FAILED`. Успішний business outcome з `FAILED` cleanup є червоним lifecycle
result; product failure не може бути замаскований cleanup.

Experiment context із cookie/localStorage `experiments` збирається best-effort
лише для diagnostics. Конкретний A/B variant не є assertion.

## Ризики

- LLM залишається стохастичним навіть із `temperature: 0`.
- Повний snapshot accumulated DOM може спричинити повтор старого кроку.
- Модель повертає text selector; повторна selector hallucination або grounded,
  але невиконувана дія дає `stuck`.
- Anthropic availability, latency і cost стають частиною test infrastructure.
- Дані форми передаються зовнішньому AI provider; допустимі лише синтетичні
  identities та погоджена data policy.
- Stage inventory визначає, чи funnel завершиться як `BOOKED`, чи через
  альтернативну terminal-гілку `LEAD_CREATED`; ці результати не можна
  маскувати один під одного.
- Live flow створює сутності та може зачіпати CRM/analytics до автоматичного
  видалення; deletion каскадно скасовує майбутній урок.
- Географія CI runner може впливати на A/B assignment і локалізацію.

## Чому реалізація невелика

Практична частина обирає один vertical slice — Варіант 2. Вона не намагається
стати універсальним agent framework: AI лишається навігатором мінливого UI, а
мережеві boundaries, business verification, cleanup, sanitization і CI є
детермінованими.
