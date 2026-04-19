# Slidev Agent — мультиагентная система генерации презентаций

**Slidev Agent** — это мультиагентная система, которая автоматически создаёт презентации дизайнерского качества на основе текстового описания. Система использует [Slidev](https://sli.dev/) (презентационный фреймворк на Vue/Markdown) и состоит из shared-skill оркестрации и 8 специализированных worker-агентов, работающих по конвейерному принципу.

Вы описываете тему и стиль — система сама исследует контент, подбирает layouts, генерирует SVG-иллюстрации и Mermaid-диаграммы, собирает финальный `slides.md`, пишет `output/<slug>.deck-spec.json`, проверяет качество и экспортирует в PDF/editable-PPTX/PNG.

---

## Содержание

- [Зачем нужен opencode или Codex](#зачем-нужен-opencode-или-codex)
- [Установка](#установка)
- [Запуск через opencode](#запуск-через-opencode)
- [Запуск через OpenAI Codex](#запуск-через-openai-codex)
- [Windows: caveats и проверка окружения](#windows-caveats-и-проверка-окружения)
- [Как пользоваться](#как-пользоваться)
- [Архитектура и пайплайн](#архитектура-и-пайплайн)
- [Агенты](#агенты)
- [Структура проекта](#структура-проекта)
- [Доступные темы](#доступные-темы)
- [Компоненты](#компоненты)
- [Кастомные layouts](#кастомные-layouts)
- [Экспорт](#экспорт)
- [Troubleshooting](#troubleshooting)
- [Дуальная конфигурация](#дуальная-конфигурация-синхронизация-opencode--codex)
- [Внесение изменений](#внесение-изменений)
- [Известные проблемы](#известные-проблемы)

---

## Зачем нужен opencode или Codex

Эта система **не является** самостоятельным приложением — это набор инструкций (промптов) для AI-агентов. Чтобы агенты заработали, нужен **хост-рантайм** (harness), который:

1. **Читает конфигурацию агентов** — описание, права доступа, режим работы
2. **Загружает навыки (skills)** — справочник по синтаксису Slidev из `.agents/skills/`
3. **Маршрутизирует задачи** — запускает worker-агентов через нативный subagent/task механизм рантайма
4. **Управляет песочницей** — ограничивает доступ агентов к файловой системе
5. **Предоставляет инструменты** — Bash, чтение/запись файлов, Task, Skill

Поддерживаются два рантайма:

| Рантайм | Конфигурация | Формат агентов | Команды |
|---------|--------------|----------------|---------|
| [opencode](https://opencode.ai) | `opencode.json` + `.opencode/` | Markdown (`.md`) | — |
| [OpenAI Codex](https://github.com/openai/codex) | `.codex/config.toml` + `.codex/agents/*.toml` | TOML (`.toml`) | — |

Оба рантайма читают **общий** справочник навыков из `.agents/skills/`.

---

## Установка

### Что обязательно

- [Bun](https://bun.sh/) >= 1.0
- [Node.js](https://nodejs.org/) >= 18
- Один harness-рантайм: [opencode](https://opencode.ai) или [OpenAI Codex CLI](https://github.com/openai/codex)

Это минимальный набор, чтобы harness смог читать конфигурацию агентов, запускать subagent-пайплайн и собирать `slides.md`.

### Что нужно только для экспорта

- Рабочий Chromium через Playwright
- Локальное окружение, в котором `bun run export:*` может запустить браузерный рантайм

`Chromium` нужен не самому LLM и не harness'у, а проектным export-скриптам. На части машин он подтягивается во время `bun install`, но это не гарантируется для каждого окружения. Если экспорт или harness жалуются на отсутствие браузера, установите его вручную:

```bash
bunx playwright install chromium
```

### Что опционально

- `bun run dev` для локального просмотра и ручной отладки презентации
- Ручная проверка `slides.md`, `public/` и `output/`

### Матрица зависимостей

| Сценарий | Bun | Node.js | Codex/OpenCode | Chromium через Playwright |
|----------|-----|---------|----------------|---------------------------|
| Генерация структуры и `slides.md` | ✅ | ✅ | ✅ | — |
| Генерация + экспорт PDF/editable-PPTX/PNG | ✅ | ✅ | ✅ | ✅ |
| Локальный просмотр через `bun run dev` | ✅ | ✅ | — | — |

### Базовая установка

```bash
# 1. Клонируйте репозиторий
git clone <repo-url>
cd slidev_agent

# 2. Установите project dependencies
bun install
```

### Если нужен экспорт

Сначала попробуйте экспорт после `bun install`. Если Playwright не скачал браузер автоматически или экспорт завершился ошибкой про Chromium, выполните:

```bash
# Repair-step для export path
bunx playwright install chromium
```

---

## Запуск через opencode

[opencode](https://opencode.ai) — CLI-инструмент для работы с AI-агентами. Он читает `opencode.json` из корня проекта и автоматически обнаруживает агенты и навыки.

`opencode` отвечает за orchestration/subagents и доступ к инструментам. `Bun`, `Node.js` и `Playwright` нужны уже самому проекту Slidev Agent: для dev-сервера, export-скриптов и post-processing в `scripts/fix-export.mjs`.

### Конфигурация

Файл `opencode.json` задаёт встроенного primary-агента и разрешённые skills:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "default_agent": "build",
  "permission": {
    "skill": {
      "slidev-orchestrator": "allow",
      "slidev-presentation": "allow",
      "slidev-editable-pptx": "allow"
    }
  }
}
```

### Запуск

```bash
# Интерактивный режим — opencode запустится со встроенным agent `build`
opencode
```

```text
Use $slidev-orchestrator to create a 10-slide presentation about microservices architecture in a dark minimal style
```

Если вы планируете только генерацию структуры и `slides.md`, достаточно корректно установленного `bun install`. Если нужен экспорт, убедитесь, что Playwright видит Chromium.

### Где искать определения

| Сущность | Путь |
|----------|------|
| Агенты | `.opencode/agents/slidev-*.md` |
| Инструменты | `.opencode/tools/slidev-export.ts` |
| Навыки (skills) | `.agents/skills/slidev-*/SKILL.md` |

---

## Запуск через OpenAI Codex

[OpenAI Codex](https://github.com/openai/codex) — CLI от OpenAI для работы с агентами. Он читает `.codex/config.toml` и `.codex/agents/*.toml`.

Как и в случае с `opencode`, harness здесь нужен для маршрутизации задач и запуска worker-агентов. Ошибки вокруг `Chromium` относятся не к Codex как таковому, а к локальному export path проекта.

### Конфигурация

```toml
# .codex/config.toml
[agents]
max_threads = 6
max_depth = 1

[sandbox_workspace_write]
writable_roots = [".", "./output", "./public"]
```

### Запуск

```bash
# Явно вызовите orchestration skill в запросе
codex "Use $slidev-orchestrator to create an 8-slide presentation about Kubernetes"

# Или с auto-approve
codex --full-auto "Use $slidev-orchestrator to create a 10-slide presentation about Docker using the dracula theme"
```

Для базовой генерации достаточно рабочего harness + `bun install`. Для экспортного сценария может понадобиться дополнительный шаг `bunx playwright install chromium`, особенно на Windows.

### Где искать определения

| Сущность | Путь |
|----------|------|
| Агенты | `.codex/agents/slidev-*.toml` |
| Конфигурация | `.codex/config.toml` |
| Навыки (skills) | `.agents/skills/slidev-*/SKILL.md` (те же, что и для opencode) |

---

## Windows: caveats и проверка окружения

Windows поддерживается, но как сценарий `supported with caveats`: чаще всего проблемы возникают не в harness, а в локальном browser payload для Playwright.

Рекомендуемый порядок:

```powershell
git clone <repo-url>
cd slidev_agent
bun install
```

Если вы будете экспортировать презентации, сразу проверьте Chromium:

```powershell
bunx playwright install chromium
```

Практические замечания:

- Выполняйте команды в `PowerShell`, а не в старом `cmd.exe`.
- Сообщение вида `Chromium executable doesn't exist` означает, что Playwright не нашел свой браузерный payload. Это не поломка Slidev deck и не ошибка в самих промптах.
- Упоминания `darwin`, `macOS`, `Apple` или других platform-specific optional packages в логах `bun install` не означают, что Windows требует эти пакеты. Это нормальная часть кроссплатформенных зависимостей в lockfile.
- Если после `bun install` генерация работает, а экспорт нет, почти всегда нужно чинить именно Playwright browser install.

---

## Как пользоваться

### Простой запрос

Опишите тему, количество слайдов и желаемый стиль:

```text
Use $slidev-orchestrator to create a 12-slide presentation about Flutter. Dark theme, dracula style. Include an architecture diagram and performance statistics.
```

### Что можно указать в запросе

| Параметр | Пример | Значение по умолчанию |
|----------|--------|----------------------|
| Тема презентации | «Микросервисы» | — (обязательный) |
| Количество слайдов | «10 слайдов» | 10 |
| Визуальный стиль | «тёмный минимализм» | `seriph` |
| Диаграммы | «включить диаграмму потоков» | автоматически |
| Иллюстрации | «с SVG-иллюстрациями» | автоматически |
| Код | «показать примеры кода» | нет |
| Статистика | «добавить цифры и графику» | нет |

### Результат

После выполнения пайплайна в проекте появятся:

- `slides.md` — исходник презентации (Slidev Markdown)
- `output/<slug>.deck-spec.json` — machine-readable spec для editable PPTX
- `public/*.svg` — сгенерированные SVG-иллюстрации
- `output/*.pdf` — экспорт в PDF
- `output/*.pptx` — editable PowerPoint
- `output/<name>/` — PNG каждого слайда

### Просмотр и редактирование в реальном времени

```bash
# Запустите dev-сервер для интерактивного просмотра
bun run dev
# Откройте http://localhost:3030
```

---

## Архитектура и пайплайн

Система работает в 5 фаз, запускаемых shared skill `slidev-orchestrator`, который использует 8 worker-агентов:

```
┌─────────────────────────────────────────────────────┐
│  Фаза 1: Планирование (root agent + skill)           │
│  • Анализ промпта                                    │
│  • Выбор темы и стиля                                │
│  • План: title, layout, contentType для каждого      │
│    слайда                                            │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│  Фаза 2: Параллельная генерация (4 subagent'а)       │
│                                                       │
│  ┌──────────────┐  ┌──────────────────┐              │
│  │ content-     │  │ layout-designer  │              │
│  │ researcher   │  │                  │              │
│  └──────────────┘  └──────────────────┘              │
│  ┌──────────────┐  ┌──────────────────┐              │
│  │ illustrator  │  │ diagrammer       │              │
│  └──────────────┘  └──────────────────┘              │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│  Фаза 3: Сборка + стилизация (последовательно)       │
│  1. assembler → slides.md + deck-spec.json           │
│  2. stylist  → анимации, переходы, CSS-полировка     │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│  Фаза 4: Ревью (reviewer)                            │
│  • Проверка синтаксиса, дизайна, контента            │
│  • Если не прошло → назад к stylist (макс. 2 раза)   │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│  Фаза 5: Экспорт (exporter)                          │
│  • PDF, editable PPTX, PNG                           │
│  • Legacy raster PPTX — отдельный fallback path      │
│  • Автоматическая коррекция пустой первой страницы   │
└─────────────────────────────────────────────────────┘
```

---

## Агенты

Пайплайн запускается shared skill `slidev-orchestrator`. Ниже перечислены только 8 worker-агентов, которые должны оставаться синхронизированными между opencode и Codex.

| Агент | Роль | Режим |
|-------|------|-------|
| **slidev-content-researcher** | Генерация структурированного контента для слайдов | Subagent |
| **slidev-layout-designer** | Подбор layout, темы, визуального дизайна | Subagent |
| **slidev-illustrator** | Создание SVG-иллюстраций | Subagent |
| **slidev-diagrammer** | Создание Mermaid-диаграмм | Subagent |
| **slidev-assembler** | Сборка финального `slides.md` и `deck-spec.json` | Subagent |
| **slidev-stylist** | Анимации, переходы, CSS-полировка | Subagent |
| **slidev-reviewer** | Проверка качества и корректности | Subagent |
| **slidev-exporter** | Экспорт в PDF/editable-PPTX/PNG | Subagent |

---

## Структура проекта

```
slidev_agent/
├── slides.md                  # Сгенерированная презентация (Slidev Markdown)
├── schemas/
│   └── deck-spec.schema.json  # Схема для machine-readable deck spec
├── package.json               # Зависимости и скрипты экспорта
├── opencode.json              # Конфигурация opencode
├── AGENTS.md                  # Краткое описание архитектуры для AI
│
├── .opencode/                 # Конфигурация opencode
│   ├── agents/                # Агенты в формате Markdown
│   │   ├── slidev-content-researcher.md
│   │   ├── slidev-layout-designer.md
│   │   ├── slidev-illustrator.md
│   │   ├── slidev-diagrammer.md
│   │   ├── slidev-assembler.md
│   │   ├── slidev-stylist.md
│   │   ├── slidev-reviewer.md
│   │   └── slidev-exporter.md
│   └── tools/                 # Кастомные инструменты (экспорт)
│       └── slidev-export.ts
│
├── .codex/                    # Конфигурация OpenAI Codex
│   ├── config.toml            # Настройки рантайма
│   └── agents/                # Агенты в формате TOML
│       └── ...                # (те же 8 worker-агентов)
│
├── .agents/                   # Общие навыки (skills)
│   └── skills/
│       ├── slidev-orchestrator/
│       │   ├── SKILL.md       # Оркестрация полного пайплайна
│       │   └── agents/openai.yaml
│       ├── slidev-editable-pptx/
│       │   ├── SKILL.md       # Локальный editable PowerPoint export
│       │   └── agents/openai.yaml
│       └── slidev-presentation/
│           └── SKILL.md       # Справочник по синтаксису Slidev
│
├── components/                # Vue-компоненты для презентаций
│   ├── StatCard.vue
│   ├── Timeline.vue
│   ├── ComparisonTable.vue
│   ├── ImageGrid.vue
│   └── SectionNumber.vue
│
├── layouts/                   # Кастомные layouts
│   ├── hero-center.vue
│   ├── stat-grid.vue
│   ├── side-by-side.vue
│   └── full-image.vue
│
├── styles/                    # Глобальные стили
│   └── index.ts
│
├── public/                    # Статические файлы и SVG
│   └── .gitkeep
│
├── output/                    # Результаты экспорта и deck specs
│   └── .gitkeep
│
└── scripts/
    ├── deck-spec.mjs          # Загрузка и проверка deck spec
    ├── export-slidev.mjs
    ├── fix-export.mjs         # Исправление пустой первой страницы
    └── validate-deck-spec.mjs
```

---

## Доступные темы

| Тема | Пакет | Стиль | Для чего подходит |
|------|-------|-------|-------------------|
| `seriph` | `@slidev/theme-seriph` | Чистый минимализм | Технические доклады, универсальные |
| `apple-basic` | `@slidev/theme-apple-basic` | Простота Apple | Продуктовые презентации |
| `default` | `@slidev/theme-default` | Стандартный Slidev | Универсальные |
| `bricks` | `@slidev/theme-bricks` | Структурированные блоки | Образование, структурированный контент |
| `dracula` | `slidev-theme-dracula` | Тёмно-фиолетовый | Тёмные темы, доклады разработчиков |

---

## Компоненты

В проекте есть готовые Vue-компоненты для использования в слайдах:

### StatCard — карточка со статистикой
```html
<StatCard value="99.9%" label="Uptime" color="#10b981" />
<StatCard value="2.5M" label="Пользователей" icon="👥" />
```

### Timeline — временная шкала
```html
<Timeline>
  <template #item-1><strong>2020</strong> — Старт проекта</template>
  <template #item-2><strong>2022</strong> — Мажорный релиз</template>
  <template #item-3><strong>2024</strong> — Отраслевой стандарт</template>
</Timeline>
```

### ComparisonTable — таблица сравнения
```html
<ComparisonTable
  :headers="['Функция', 'Базовый', 'Про']"
  :rows="[
    ['Пользователи', '5', 'Безлимит'],
    ['Хранилище', '1 ГБ', '100 ГБ'],
  ]"
/>
```

### ImageGrid — сетка изображений
```html
<ImageGrid :cols="2" gap="4">
  <img src="/img1.svg" />
  <img src="/img2.svg" />
</ImageGrid>
```

### SectionNumber — номер секции
```html
<SectionNumber :number="1" title="Введение" />
```

---

## Кастомные layouts

Помимо встроенных layouts Slidev (`cover`, `center`, `section`, `two-cols`, `image-right`, `fact`, `quote`), доступны:

| Layout | Описание |
|--------|----------|
| `hero-center` | Полноэкранный hero с центрированным контентом и опциональным SVG-фоном |
| `stat-grid` | Сетка для StatCard-компонентов |
| `side-by-side` | Две колонки с вертикальным разделителем |
| `full-image` | Изображение/SVG на весь слайд с наложением текста |

---

## Экспорт

### Скрипты

```bash
bun run export:pdf    # → ./output/<name>.pdf
bun run export:pptx   # → ./output/<name>.pptx (editable)
bun run export:png    # → ./output/<name>/1.png, 2.png, ...
bun run export:all    # Все поддерживаемые форматы
```

`bun run export:pptx` использует локальный native builder из `scripts/native-pptx/` и `output/<slug>.deck-spec.json`, чтобы создавать редактируемый PowerPoint.

Это единственный поддерживаемый путь экспорта в проекте. Не запускайте raw `slidev export` или `npx slidev export` напрямую: они обходят зафиксированные project settings и post-processing через `scripts/fix-export.mjs`.

### Dev-сервер

```bash
bun run dev           # → http://localhost:3030
```

### Важно: баг пустой первой страницы

Slidev v52.x генерирует пустую первую страницу при экспорте в PDF/PNG. Проект включает скрипт `scripts/fix-export.mjs`, который автоматически:
- Удаляет первую (пустую) страницу из PDF
- Удаляет `1.png` и перенумеровывает остальные файлы

Все скрипты `bun run export:*` уже вызывают `fix-export.mjs` — **не запускайте `slidev export` напрямую**.

---

## Troubleshooting

### Harness или экспорт ругается на Chromium

Это почти всегда означает, что Playwright не нашел установленный браузер. Для проектного export path выполните:

```bash
bunx playwright install chromium
```

После этого повторите `bun run export:pdf`, `bun run export:pptx`, `bun run export:png` или orchestration pipeline.

### PNG-экспорт создал пустую директорию

В проекте PNG должны экспортироваться только через `bun run export:png`, потому что этот скрипт уже использует правильный режим ожидания рендера. Если запускать raw `slidev export` с `--wait-until load`, директория может оказаться пустой.

### Первый кадр или первая страница пустые

Это известный баг `Slidev v52.x`. Проект обходит его через `scripts/fix-export.mjs`, который автоматически вызывается из `bun run export:pdf` и `bun run export:png`.

### PPTX экспорт не находит deck spec

`bun run export:pptx` требует `output/<slug>.deck-spec.json`, созданный обновлённым `slidev-assembler`. Если файла нет, пересоберите презентацию через актуальный пайплайн.

### В логах установки мелькают darwin/macOS/Apple-пакеты

Это нормально для кроссплатформенных JS-зависимостей. В `bun.lock` могут присутствовать optional packages для `darwin`, `linux` и `win32` одновременно. Их наличие в логах не означает, что Windows требует macOS-зависимости.

---

## Дуальная конфигурация: синхронизация opencode ↔ Codex

Проект поддерживает **оба** рантайма одновременно. Worker-агенты хранятся в двух форматах, а orchestration skills являются общими:

```
.opencode/agents/slidev-content-researcher.md  ←→  .codex/agents/slidev-content-researcher.toml
...и так для всех 8 worker-агентов
```

### Правило синхронизации

> **Любое изменение в агенте, навыке или конфигурации необходимо применять в ОБОИХ директориях одновременно.**

- **Worker-агенты**: `.opencode/agents/*.md` ↔ `.codex/agents/*.toml` — описания, инструкции и права доступа должны совпадать
- **Навыки**: `.agents/skills/*/SKILL.md` — общие для обеих систем, включая `slidev-orchestrator`, `slidev-presentation` и `slidev-editable-pptx`
- **Инструменты**: `.opencode/tools/*.ts` — только для opencode (Codex не поддерживает кастомные инструменты)

---

## Внесение изменений

### Редактирование промптов агентов и skills

Промпты — это и есть «код» этой системы. Чтобы изменить поведение:

1. Для worker-агента отредактируйте `.opencode/agents/<agent>.md`
2. Отредактируйте `.codex/agents/<agent>.toml` — **то же самое** содержание
3. Для orchestration logic редактируйте `.agents/skills/slidev-orchestrator/SKILL.md`
4. Проверьте, что инструкции, описание и права доступа идентичны там, где требуется зеркалирование

### Добавление нового компонента

1. Создайте `components/MyComponent.vue`
2. Добавьте документацию в `.agents/skills/slidev-presentation/SKILL.md` (оба рантайма её прочитают)

### Добавление нового layout

1. Создайте `layouts/my-layout.vue`
2. Добавьте описание в SKILL.md

### Добавление новой темы

1. Установите пакет: `bun add -D @slidev/theme-<name>`
2. Добавьте тему в таблицу в SKILL.md

### Изменение скриптов экспорта

1. Обновите `scripts/fix-export.mjs`, `scripts/export-slidev.mjs` или native builder в `scripts/native-pptx/`
2. Обновите команды в `package.json`
3. При необходимости — обновите `.opencode/tools/slidev-export.ts`

---

## Известные проблемы

- **Slidev v52.x**: пустая первая страница при экспорте — обходится через `scripts/fix-export.mjs`
- **PNG-экспорт**: требует `--wait-until networkidle`, иначе директория может оказаться пустой
- **Editable PPTX**: опирается на `deck-spec.json` и native builder, а не на обратный парсинг `slides.md`
- **v-click**: не используйте директиву `v-click` в слайдах, предназначенных для экспорта — она создаёт промежуточные «пустые» фреймы
- **transition: fade** на обложке: анимация может быть поймана скриншотом в середине перехода

---

## Лицензия

Проект предназначен для локального использования. Убедитесь, что у вас есть доступ к соответствующей LLM (через opencode или Codex) для работы агентов.
