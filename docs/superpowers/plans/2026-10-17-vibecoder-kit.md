# Набор для вайбкодера — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Превратить репозиторий в набор, который агент вайбкодера ставит в чужое приложение по одной фразе: приём жалоб, исследование, исправление с падающим тестом, проверка в проде, еженедельный запуск, три рутины.

**Architecture:** Канон — `templates/` (workflow, скрипты, промпты рутин, кусок `CLAUDE.md`), которые агент копирует в приложение. Решения, которые можно проверить кодом, живут в маленьких ES-модулях `templates/scripts/udd/*.mjs` с тестами на `node --test`; workflow только вызывают их. Инструкции для агента — `SETUP.md`, `ROUTINES.md`, `WEEKLY.md`; для человека — `README.md`, `RULES.md`. Собственные `.github/workflows/udd-*.yml` репозитория — байт-в-байт копии шаблонов (демо настраивается переменными репозитория).

**Tech Stack:** GitHub Actions, `anthropics/claude-code-action@v1` (токен подписки `CLAUDE_CODE_OAUTH_TOKEN`), Node 24 (`node --test`, без новых зависимостей), Playwright (JSON-репортёр), `gh` CLI, `actionlint`.

**Spec:** `docs/superpowers/specs/2026-10-17-vibecoder-kit-design.md`

## Global Constraints

- Всё работает на подписке Claude Pro/Max: в шаблонах `claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}`; `anthropic_api_key` остаётся необязательной альтернативой.
- Никаких новых npm-зависимостей в корне и в `templates/`.
- Код агента никогда не исполняется рядом с токеном на запись: схема guard → agent (чтение) → publish (запись) из нынешнего `.github/workflows/udd-fix.yml` сохраняется во всех workflow, которые запускают модель.
- Текст жалобы и вывод агента — недоверенные: в issue и комментарии попадают только через `neutralise` / `sanitizeAgentText`.
- Файлы для агента (`SETUP.md`, `ROUTINES.md`, `WEEKLY.md`, промпты рутин) — не длиннее 300 строк; каждый шаг: что сделать → как проверить → что делать при неудаче.
- Тексты для людей — английский, простой стиль, прогон через навык `humanizer`, без длинных тире.
- Обезличивание: перед любым `git push` — `.git/hooks/pre-push` должен вывести `anonymization check: clean`. Название рабочей системы и компании не упоминаются нигде.
- Ограничение бокса: тесты и сборки с `--maxWorkers`/`-j` не выше 4; одновременно не больше трёх агентов, гоняющих `npm`.
- Метки (точно эти имена): `feedback`, `researched`, `approved`, `in-progress`, `fix-ready`, `shipped`, `verified`, `needs-human`, `routine`, `routine:dead-code`, `routine:duplicates`, `routine:security`, `security`.
- Переменные репозитория: `UDD_AGENT_ENABLED` (`true` включает), `UDD_TEST_CMD` (по умолчанию `npm test`), `UDD_E2E_CMD` (по умолчанию `npx playwright test`), `UDD_TEST_GLOB` (по умолчанию `**/*.spec.ts,**/*.test.ts,e2e/**`), `UDD_PROD_URL`. Секреты: `CLAUDE_CODE_OAUTH_TOKEN`, `UDD_TEST_USER_EMAIL`, `UDD_TEST_USER_PASSWORD`.
- Метка теста в Playwright: `@udd-<номер issue>` (в заголовке теста или в `tag`).

## Review Focus

1. Жалоба с `@claude`, HTML или текстом длиннее 60 000 символов → упоминание не срабатывает, HTML не исполняется, тело issue обрезается до 65 000 символов с пометкой. Тест — задача 1.
2. Метку `approved` ставит бот или issue без `feedback` → fix не запускается. Тест на наличие условий в шаблоне — задача 5.
3. Агент не добавил тест с меткой или тест проходит на старом коде → попытка не засчитывается, причина в комментарии. Тест — задача 2.
4. Проверка в проде упала → `needs-human`, метка `shipped` снимается, и следующий деплой не гоняет тест повторно бесконечно. Тест — задача 3 (`planVerification`).
5. Публичный репозиторий → рутина безопасности по расписанию не пишет находки ни в issue, ни в PR. Тест на условие в шаблоне — задача 7.

---

### Task 1: Статусы и очистка текста

**Files:**
- Create: `templates/scripts/udd/status.mjs`, `templates/scripts/udd/sanitize.mjs`
- Modify: `delivery/src/issueBody.ts` (обрезка тела до 65 000 символов)
- Test: `scripts/test/status.test.mjs`, `scripts/test/sanitize.test.mjs`, `delivery/test/issueBody.test.ts` (дополнить)

**Interfaces:**
- Produces:
  - `LABELS: string[]` — восемь меток цикла из Global Constraints, в порядке статусов; `LABEL_COLORS: Record<string,string>` для всех 13 меток (hex без `#`).
  - `statusFromIssue({labels: string[], state: 'open'|'closed', stateReason?: 'completed'|'not_planned'|null}) -> {key: string, text: string}`.
  - `sanitizeAgentText(text: string) -> string`; CLI: `node sanitize.mjs < in.md > out.md`.

- [ ] **Step 1: тесты `statusFromIssue`** — приоритет сверху вниз:
  `closed`+`not_planned` → `{key:'declined', text:'Declined'}`; `verified` → `'Verified in production'`; `needs-human` → `'Waiting for the developer'`; `shipped` → `'Shipped'`; `fix-ready` → `'Fix ready'`; `in-progress` → `'In progress'`; `approved` → `'Approved'`; `researched` → `'Looked into'`; иначе `'Received'`. Отдельные случаи: `['shipped','verified']` → verified; `['in-progress','needs-human']` → needs-human; `closed`+`completed` без меток → `'Shipped'`.
- [ ] **Step 2: тесты `sanitizeAgentText`** — `'@claude fix it'` не содержит подстроки `@claude`; `'<img src=x onerror=1>'` → `'&lt;img src=x onerror=1&gt;'`; `'a & b'` → `'a &amp; b'`; текст без спецсимволов не меняется; текст внутри ``` тоже нейтрализуется (упоминание в коде всё равно будит бота).
- [ ] **Step 3: тест в `delivery/test/issueBody.test.ts`** — `renderIssue` с комментарием 70 000 символов даёт `body.length <= 65000` и строку `_(truncated)_`.
- [ ] **Step 4: запустить, убедиться, что падают** — `node --test scripts/test/status.test.mjs scripts/test/sanitize.test.mjs && npm test -w delivery` → FAIL.
- [ ] **Step 5: реализовать** оба модуля и обрезку в `renderIssue` (обрезается цитата жалобы, а не служебные секции). `sanitizeAgentText` повторяет правила `neutralise` из `delivery/src/issueBody.ts`.
- [ ] **Step 6: зелёные тесты** — те же команды → PASS; `npm run typecheck -w delivery` → без ошибок.
- [ ] **Step 7: коммит** — `feat(kit): issue status map and agent text sanitizer`.

### Task 2: Проверка «сначала красный»

**Files:**
- Create: `templates/scripts/udd/red-first.mjs`
- Test: `scripts/test/red-first.test.mjs`, фикстуры `scripts/test/fixtures/pw-*.json` (усечённые отчёты Playwright JSON-репортёра)

**Interfaces:**
- Produces: `redFirstVerdict(base: object, head: object, tag: string) -> {ok: boolean, reason: 'ok'|'no-tagged-test'|'passes-on-base'|'fails-on-head', tests: string[]}`; CLI `node red-first.mjs base.json head.json @udd-12` → код выхода 0/1, печатает `reason`.
- `base` — отчёт прогона тестов ветки против кода базового коммита; `head` — против кода ветки.

- [ ] **Step 1: тесты** — нет тестов с `tag` в `head` → `no-tagged-test`; помеченный тест `passed` в `base` → `passes-on-base`; помеченный тест не `passed` в `head` → `fails-on-head`; помеченный тест отсутствует в `base` или `failed`/`timedOut` там, а в `head` `passed` → `ok` и его заголовок в `tests`. Метка находится и в `spec.title`, и в `spec.tags`. Обход вложенных `suites`.
- [ ] **Step 2: запустить** — `node --test scripts/test/red-first.test.mjs` → FAIL.
- [ ] **Step 3: реализовать** — статус теста берётся из последнего элемента `results`; повторные попытки не делают упавший на базе тест «прошедшим».
- [ ] **Step 4: зелёный прогон** → PASS.
- [ ] **Step 5: коммит** — `feat(kit): red-first verdict from Playwright reports`.

### Task 3: План проверки в проде и защита рутин

**Files:**
- Create: `templates/scripts/udd/verify-plan.mjs`, `templates/scripts/udd/routine-guard.mjs`
- Test: `scripts/test/verify-plan.test.mjs`, `scripts/test/routine-guard.test.mjs`

**Interfaces:**
- Produces:
  - `planVerification(issues: {number:number, labels:string[]}[]) -> number[]` — номера issue с `shipped` и без `verified`/`needs-human`, по возрастанию.
  - `verificationOutcome(passed: boolean) -> {add: string[], remove: string[], close: boolean}` — прошёл: `{add:['verified'], remove:['shipped'], close:true}`; упал: `{add:['needs-human'], remove:['shipped'], close:false}`.
  - `shouldRun(routine: string, openItems: {labels:string[]}[]) -> boolean` — `false`, если открыт PR или issue с меткой `routine:<routine>`.
  - `filterKnown(findings: {key:string}[], known: {key:string}[]) -> {key:string}[]`; формат `.udd/known-findings.json`: `[{"key":"<routine>:<path>:<rule>","reason":"…","date":"YYYY-MM-DD"}]`.
  - CLI обоих модулей читают JSON со stdin и печатают JSON.

- [ ] **Step 1: тесты** — `planVerification` пропускает `verified` и `needs-human`; `verificationOutcome(false).remove` содержит `shipped` (Review Focus 4); `shouldRun('security', [{labels:['routine','routine:security']}]) === false`; `shouldRun('security', [{labels:['routine:dead-code']}]) === true`; `filterKnown` убирает совпадения по `key`, сохраняет порядок.
- [ ] **Step 2: FAIL** — `node --test scripts/test/verify-plan.test.mjs scripts/test/routine-guard.test.mjs`.
- [ ] **Step 3: реализовать.**
- [ ] **Step 4: PASS.**
- [ ] **Step 5: коммит** — `feat(kit): verification plan and routine guard`.

### Task 4: `udd-research.yml`

**Files:**
- Create: `templates/workflows/udd-research.yml`; копия `.github/workflows/udd-research.yml`
- Test: `scripts/test/templates.test.mjs` (создаётся здесь, дополняется задачами 5–7)

**Interfaces:**
- Consumes: `templates/scripts/udd/sanitize.mjs` (задача 1). В приложении скрипты лежат в `.udd/scripts/` — шаблоны вызывают `node .udd/scripts/sanitize.mjs`; в этом репозитории `.udd/scripts/` — копия `templates/scripts/udd/` (проверяется тестом синхронизации).

- [ ] **Step 1: тест** `templates.test.mjs`: (а) каждый `templates/workflows/*.yml` побайтно равен `.github/workflows/<то же имя>`; (б) каждый `templates/scripts/udd/*.mjs` равен `.udd/scripts/<то же имя>`; (в) в `udd-research.yml` есть `issues:` с `types: [opened, labeled]`, условие на метку `feedback` и отсутствие `researched`, `--allowedTools` без `Bash`.
- [ ] **Step 2: FAIL.**
- [ ] **Step 3: написать workflow** — три задачи: `guard` (как в `udd-fix.yml`: `UDD_AGENT_ENABLED`, наличие токена, issue ещё без `researched`); `agent` (`contents: read`, `issues: read`, Claude Code Action с `--allowedTools "Read,Glob,Grep,Write"`, промпт: недоверенный текст в маркерах как в `udd-fix.yml`; найти вероятную причину с путями и строками, дубли среди открытых issue (список передаётся в промпт шагом `gh issue list --label feedback --json number,title`), что неясно, какой тест должен упасть; записать ответ в `udd-research.md` в корне; артефакт); `publish` (`issues: write`: `node .udd/scripts/sanitize.mjs < udd-research.md`, `gh issue comment --body-file`, `gh issue edit --add-label researched`).
- [ ] **Step 4: PASS** + `actionlint templates/workflows/udd-research.yml` → без ошибок.
- [ ] **Step 5: коммит** — `feat(kit): research workflow`.

### Task 5: `udd-fix.yml` с красным тестом и тремя попытками

**Files:**
- Create: `templates/workflows/udd-fix.yml`
- Modify: `.github/workflows/udd-fix.yml` (заменяется копией шаблона)
- Test: `scripts/test/templates.test.mjs`

**Interfaces:**
- Consumes: `red-first.mjs` (задача 2), `sanitize.mjs` (задача 1).

- [ ] **Step 1: тесты** — в шаблоне есть: `github.event.sender.type == 'User'`, проверка метки `feedback`, `vars.UDD_AGENT_ENABLED == 'true'` (Review Focus 2); три шага агента `attempt-1..3` с условиями «предыдущая попытка не ok»; вызов `node .udd/scripts/red-first.mjs`; задача `shipped` на `pull_request: types: [closed]` с `github.event.pull_request.merged == true` и веткой `udd/fix-*`; у задачи `agent` нет `contents: write`.
- [ ] **Step 2: FAIL.**
- [ ] **Step 3: написать workflow** на основе нынешнего `.github/workflows/udd-fix.yml` (guard/agent/publish и проверка запретных путей — без изменений по смыслу). Отличия:
  - guard ставит `in-progress`;
  - промпт агента требует браузерный тест с меткой `@udd-${ISSUE}` и исправление; на попытках 2–3 в промпт добавляется причина из `red-first` прошлой попытки;
  - после каждой попытки: сохранить патч; собрать базовое дерево = базовый коммит + только файлы, подходящие под `UDD_TEST_GLOB`; `${UDD_E2E_CMD} --grep @udd-${ISSUE} --reporter=json > base.json`; затем полный патч → `head.json`; `node .udd/scripts/red-first.mjs base.json head.json @udd-${ISSUE}`;
  - затем `${UDD_TEST_CMD}`;
  - после трёх неудач: publish пишет комментарий с причинами и ставит `needs-human`, PR не открывается;
  - при успехе: черновой PR как сейчас, метки `fix-ready` (снять `in-progress`);
  - задача `shipped`: номер issue из имени ветки `udd/fix-<n>`, `gh issue edit <n> --add-label shipped --remove-label fix-ready`.
- [ ] **Step 4: PASS** + `actionlint`.
- [ ] **Step 5: коммит** — `feat(kit): fix workflow with red-first check and three attempts`.

### Task 6: `udd-verify.yml`

**Files:**
- Create: `templates/workflows/udd-verify.yml` + копия в `.github/workflows/`
- Test: `scripts/test/templates.test.mjs`

**Interfaces:**
- Consumes: `verify-plan.mjs` (задача 3).

- [ ] **Step 1: тесты** — запуск по `deployment_status` с условием `github.event.deployment_status.state == 'success'` и окружением `Production` или `production`, плюс `workflow_dispatch` с входом `url`; `PLAYWRIGHT_BASE_URL` берётся из входа или `vars.UDD_PROD_URL`; используется `planVerification` и `verificationOutcome`.
- [ ] **Step 2: FAIL.**
- [ ] **Step 3: написать workflow** — одна задача без модели: `gh issue list --state all --label shipped --json number,labels` → `planVerification` → для каждого `${UDD_E2E_CMD} --grep @udd-<n>` с секретами тестового аккаунта в env → `verificationOutcome` → `gh issue edit`/`gh issue close`/комментарий со ссылкой на прогон. Без `UDD_PROD_URL` и без входа `url` — выход с понятным сообщением в summary.
- [ ] **Step 4: PASS** + `actionlint`.
- [ ] **Step 5: коммит** — `feat(kit): production verification workflow`.

### Task 7: Рутины

**Files:**
- Create: `templates/workflows/udd-routine.yml` (+ копия), `templates/routines/dead-code.md`, `templates/routines/duplicates.md`, `templates/routines/security.md`, `ROUTINES.md`
- Test: `scripts/test/routines.test.mjs` (свой файл, чтобы не пересекаться с задачами 4–6; синхронизацию копий проверяет общий тест задачи 4)

**Interfaces:**
- Consumes: `routine-guard.mjs` (задача 3), `sanitize.mjs`.

- [ ] **Step 0: открытый вопрос спецификации §11.1** — по документации GitHub выяснить, может ли `GITHUB_TOKEN` workflow создавать черновики repository security advisory (какой scope). Ответ с URL — в `ROUTINES.md`, раздел «Public repositories». Если может только с отдельным токеном — публичный вариант остаётся «только локально через `WEEKLY.md`».
- [ ] **Step 1: тесты в `routines.test.mjs`** — в `udd-routine.yml`: расписание `schedule` (раз в неделю) + `workflow_dispatch`; матрица `routine: [dead-code, duplicates, security]`; guard вызывает `routine-guard.mjs`; задача публикации находок безопасности имеет условие `github.event.repository.private == true` (Review Focus 5); `routines.test.mjs`: каждый промпт в `templates/routines/` содержит разделы `## Goal`, `## Rules`, `## Output` и не длиннее 120 строк; `security.md` перечисляет все семь проверок из спецификации §7.3.
- [ ] **Step 2: FAIL.**
- [ ] **Step 3: написать** workflow (guard → agent с чтением → publish), три промпта и `ROUTINES.md` (как включить, как отключить рутину, `.udd/known-findings.json`, правила 7.2 спецификации, платное дополнение `anthropics/claude-code-security-review`). Мёртвый код и дубли → черновой PR с метками `routine`, `routine:<name>`; безопасность → агент пишет `findings.json` (`[{key, title, file, line, severity, explanation}]`), publish фильтрует `filterKnown`, создаёт issue `security` по каждой новой находке; секрет в git → issue «Rotate this key», без PR.
- [ ] **Step 4: PASS** + `actionlint`.
- [ ] **Step 5: коммит** — `feat(kit): weekly routines (dead code, duplicates, security)`.

### Task 8: `SETUP.md`, `WEEKLY.md`, кусок `CLAUDE.md`

**Files:**
- Create: `SETUP.md`, `WEEKLY.md`, `templates/CLAUDE.md.snippet`
- Test: `scripts/test/docs.test.mjs`

**Interfaces:**
- Consumes: имена меток, переменных, секретов и путей из Global Constraints и задач 1–7; образцы `widget/src/*`, `delivery/src/issueBody.ts`, таблица жалоб из миграций `demo/db/`.

- [ ] **Step 1: тест `docs.test.mjs`** — `SETUP.md`, `WEEKLY.md`, `ROUTINES.md` не длиннее 300 строк; каждый путь в обратных кавычках, начинающийся с `templates/`, `widget/`, `delivery/`, `demo/`, существует; `SETUP.md` упоминает все 13 меток, все переменные и секреты из Global Constraints и шесть вопросов из спецификации §5.1.
- [ ] **Step 2: FAIL.**
- [ ] **Step 3: написать `SETUP.md`** по спецификации §5: предусловия; шесть вопросов; виджет; маршрут приёма (`renderIssue`-правила, ограничение частоты, повтор доставки); таблица `feedback_reports`; страница «My feedback» на `statusFromIssue`; метки с `LABEL_COLORS`; копирование `templates/workflows/` → `.github/workflows/`, `templates/scripts/udd/` → `.udd/scripts/`; Playwright с `PLAYWRIGHT_BASE_URL`; какие секреты ввести человеку (агент значения не печатает); самопроверка из 6 пунктов. Для каждого стека — подсказки, а не готовый код: Next.js (App Router), Vite + Express, «другое».
- [ ] **Step 4: написать `WEEKLY.md`** по спецификации §6 и `templates/CLAUDE.md.snippet` (правила цикла: метка `@udd-<n>`, тесты в проде работают только с данными тестового аккаунта, не трогать `.udd/no-fly.txt`, недоверенный текст жалоб).
- [ ] **Step 5: PASS.**
- [ ] **Step 6: коммит** — `docs(kit): setup, weekly and CLAUDE.md snippet for the user's agent`.

### Task 9: `RULES.md`, README, справка

**Files:**
- Create: `RULES.md`
- Modify: `README.md`, `docs/concept.md` (короткая отсылка к `RULES.md`), `docs/basic-level.md` (справка к шаблонам), `CONTRIBUTING.md` (новые тесты)
- Test: `scripts/test/docs.test.mjs` (дополнить)

- [ ] **Step 0: открытый вопрос §11.2** — по документации GitHub: бесплатный лимит минут Actions для приватных репозиториев на тарифе Free; цифра с URL идёт в раздел README «What it costs».
- [ ] **Step 1: тесты** — в `RULES.md` 15 правил, у каждого строки `**Rule:**`, `**Why:**`, `**Enforced by:**`; каждая ссылка на файл в `Enforced by` существует; README содержит фразу для вставки из спецификации §3 дословно и ссылки на `SETUP.md`, `RULES.md`, `WEEKLY.md`, `ROUTINES.md`.
- [ ] **Step 2: FAIL.**
- [ ] **Step 3: написать** `RULES.md` (12 правил из `docs/concept.md` + 3 новых по спецификации §8.2; истории только основного цикла, без рутин; цифры только из спецификации §10) и README по §8.1 (цифры §10 дословно). Прогнать оба через навык `humanizer`.
- [ ] **Step 4: PASS.**
- [ ] **Step 5: коммит** — `docs(kit): rules playbook and README for vibecoders`.

### Task 10: Общая проверка ветки

- [ ] **Step 1:** `npm ci && npm run test:unit && npm run test:scripts` (с `DATABASE_URL` как в `ci.yml`, тестовый Postgres из `docker-compose.yml`) → всё зелёное.
- [ ] **Step 2:** в `ci.yml` добавить шаг `actionlint` для `templates/workflows/*.yml` и `.github/workflows/*.yml` (бинарник через `rhysd/actionlint` в виде скачивания релиза, без новых npm-зависимостей).
- [ ] **Step 3:** `.git/hooks/pre-push` → `anonymization check: clean`.
- [ ] **Step 4:** адверсарное ревью диффа ветки против `main` с двух сторон: безопасность workflow (токены, недоверенный текст, публичные репозитории) и понятность `SETUP.md` для агента, который видит репозиторий впервые. Находки — исправить, шаги 1–3 заново.
- [ ] **Step 5:** коммит исправлений. Отправка ветки и PR — только с согласия владельца.

### Task 11 (ГЕЙТ: только после согласия владельца): Приёмка на чужих приложениях

Требует: два одноразовых репозитория на аккаунте владельца; развёртывание (выбор бесплатного хостинга — открытый вопрос §11.4); проверку события деплоя (§11.3).

- [ ] **Step 1:** создать два чистых приложения — Next.js + Supabase и Vite + React + Express — в одноразовых репозиториях.
- [ ] **Step 2:** свежая сессия Claude Code получает только фразу из README; записать, какие вопросы задал агент и где застрял.
- [ ] **Step 3:** сквозной прогон по спецификации §9.2 в каждом приложении; три отказа §9.5.
- [ ] **Step 4:** ручной запуск каждой рутины; рутина безопасности находит посаженную дыру.
- [ ] **Step 5:** всё, где агент застрял, — правка `SETUP.md`/шаблонов (возврат в задачи 4–8), повтор.

### Task 12 (после задачи 11): Пост

- [ ] Переписать пост по спецификации §8.3, прогнать через `humanizer`, сверить каждую цифру со спецификацией §10, отдать владельцу. Публикует владелец.

---

## Исполнение (выбрано владельцем: ultracode-воркфлоу)

| Агент | Модель | Задачи | Зависимости |
|---|---|---|---|
| scripts | Sonnet | 1, 2, 3 | — |
| workflows | Sonnet | 4, 5, 6 | интерфейсы задач 1–3 (из этого плана), запуск после scripts |
| routines | Sonnet | 7 | интерфейсы задачи 3, запуск после scripts |
| setup-docs | Sonnet | 8 | после workflows и routines (берёт фактические имена) |
| rules-readme | Sonnet | 9 | параллельно с setup-docs |
| gh-docs-lookup | Haiku | шаги 0 задач 7 и 9 | — (ответы передаются в routines и rules-readme) |
| checks | Haiku | 10.1–10.3 | после всех |
| review ×2 | Sonnet | 10.4 (две линзы) | после checks |
| итог | основная сессия (Opus) | исправления по ревью, финальная проверка, отчёт | — |

Агенты работают в одной ветке `vibecoder-kit`, каждый правит только свои файлы и коммитит их командой `git commit -m "…" -- <свои пути>` (не `git commit -a` и не голый `git commit`, чтобы не захватить чужое из индекса). `templates.test.mjs` принадлежит агенту workflows, `routines.test.mjs` — агенту routines. Задачи 11–12 не входят в воркфлоу.
