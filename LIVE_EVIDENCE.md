# Live stage evidence

Санітизований журнал ручних headed-запусків. Він не містить API keys,
паролів, user IDs, імен, телефонів, email, повних API payload або browser
trace/video.

| Date | Outcome | Product evidence | Runner result | Duration | AI steps |
| --- | --- | --- | --- | ---: | ---: |
| 2026-07-30 | `LEAD_CREATED` | `POST /users` captured; parent flow; terminal `/request-gotten` | passed | ~2.4 min | 29 |
| 2026-07-31 | `BOOKED` | `POST /users` captured; booking popup dismissed; backend confirmed trial `lessons-scheduled >= 1` and filtered lesson record | passed | 2.8 min | 32 |

## Reproduction command

```bash
npm run test:e2e:headed
```

Live flow uses one worker and no retry. A run creates a real stage user and may
consume one available trial slot.

## 2026-07-31 booking observation

An earlier run on the same day reached the final lesson dashboard but the
runner reported `FAILED`: the model returned `stuck` from a stale booking-screen
snapshot after the UI had already advanced. That run is not counted as a green
result above. The navigator and verifier were then changed so terminal
network/UI/backend evidence takes priority over a stale AI decision. The next
headed run produced the green `BOOKED` result recorded in the table.
