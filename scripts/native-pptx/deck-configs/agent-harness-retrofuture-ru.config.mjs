export const agentHarnessRetrofutureRuNativeConfig = {
  deckId: "agent-harness-retrofuture-ru-native",
  overrides: {
    1: {
      kicker: "Agent Runtime / Control Room",
      intro: "Что это такое и по каким принципам он работает",
      cards: [
        {
          title: "3 слоя",
          body: "Контекст, оркестрация и надежность превращают модель в работающую систему.",
        },
        {
          title: "Двигатель",
          body: "LLM дает рассуждение, но не управляет риском, средой и артефактами.",
        },
        {
          title: "Шасси",
          body: "Harness собирает вход, допускает действия и фиксирует след исполнения.",
        },
      ],
    },
    2: {
      kicker: "Проблема",
      leftLabel: "Одиночный prompt",
      leftBody:
        "Хороший ответ не равен управляемому выполнению. Без harness модель не держит среду, не знает политик и не оставляет воспроизводимый след.",
      chips: ["Текст ≠ выполнение", "Harness = управляемый шаг"],
      rightBoxes: [
        { title: "Среда", body: "Модель сама не управляет доступами и внешним миром." },
        { title: "Контекст", body: "История быстро разрастается и вытесняет полезный сигнал." },
        { title: "Контракт", body: "Вызовы инструментов требуют схемы входов и понятного результата." },
        { title: "Следы", body: "Без логов, артефактов и политик результат нельзя повторить и проверить." },
      ],
    },
    3: { kicker: "Базовый контур" },
    4: { kicker: "Определение" },
    5: { sectionNo: "01", kicker: "Слой 1" },
    6: { kicker: "Сборка контекста" },
    7: { kicker: "Режимы памяти" },
    8: { kicker: "Guardrails" },
    9: { kicker: "Исполнительные органы" },
    10: { sectionNo: "02", kicker: "Слой 2" },
    11: { kicker: "Роли внутри контура" },
    12: { kicker: "Решение о декомпозиции" },
    13: { kicker: "Fan-out / Fan-in" },
    14: {
      kicker: "Наблюдаемость",
      timelineTitle: "Цепочка следов",
      timeline: [
        "Событие — запрос и политики на входе.",
        "Span — каждый tool call и задержка.",
        "Artifact — plan, trace, review, output.",
        "Metric — P95 шага, доля ретраев, стоимость.",
        "Replay — версии модели, промпта и среды.",
      ],
    },
    15: { sectionNo: "03", kicker: "Слой 3" },
    16: { kicker: "Resilience mechanics" },
    17: { kicker: "Governance" },
    18: { kicker: "End-to-end" },
    19: { kicker: "Итог" },
    20: {
      kicker: "Closing Signal",
      chips: ["LLM = рассуждение", "Harness = исполнение", "Система = связка"],
    },
  },
  diagramImageLayouts: {
    8: {
      kind: "process",
      frame: { left: 548, top: 298, width: 644, height: 214 },
      asset: { width: 664, height: 232 },
      processOptions: {
        left: 26,
        top: 64,
        nodeWidth: 120,
        nodeHeight: 96,
        gap: 16,
        bodySize: 12,
        titleSize: 14,
        lastAccent: "#FF6A46",
      },
    },
    13: {
      kind: "fanOutCompact",
      frame: { left: 608, top: 144, width: 620, height: 418 },
      asset: { width: 640, height: 430 },
    },
    17: {
      kind: "process",
      frame: { left: 622, top: 304, width: 586, height: 176 },
      asset: { width: 620, height: 188 },
      processOptions: {
        left: 24,
        top: 52,
        nodeWidth: 170,
        nodeHeight: 104,
        gap: 18,
        bodySize: 13,
        titleSize: 15,
        lastAccent: "#FF6A46",
      },
    },
  },
  approvedDiagramCrops: {
    18: {
      sourceSlide: 18,
      outputName: "diagram-slide-18-approved-crop.png",
      crop: {
        height: 980,
        width: 900,
        offsetY: 40,
        offsetX: 980,
      },
      frame: { left: 708, top: 30, width: 500, height: 544 },
    },
  },
  diagramSlideLayouts: {
    18: {
      mode: "bullet_panel_with_image",
      titleBlock: {
        titleLeft: 34,
        titleTop: 94,
        titleWidth: 520,
        titleHeight: 132,
        titleSize: 42,
        subtitleLeft: 36,
        subtitleTop: 218,
        subtitleWidth: 520,
      },
      bulletPanel: { left: 34, top: 280, width: 436, height: 366 },
      bulletText: { left: 82, top: 318, width: 340, height: 286, fontSize: 22, wrapWidthChars: 22 },
    },
  },
};

export default agentHarnessRetrofutureRuNativeConfig;
