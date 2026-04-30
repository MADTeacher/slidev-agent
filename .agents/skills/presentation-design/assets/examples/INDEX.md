# Индекс материалов для презентационных примеров

Эта папка хранит небольшие нейтральные примеры слайдов. Они нужны, чтобы быстро показать тип макета или проверить экспортный путь, а не чтобы копировать готовый текст в пользовательскую презентацию.

## Примеры

| Сценарий | Формат | Файл |
|---|---:|---|
| Обложка | HTML 16:9 | `cover/strategy-cover.html` |
| Метрики и вывод | HTML 16:9 | `data/metrics-slide.html` |
| Сравнение вариантов | HTML 16:9 | `comparison/options-slide.html` |
| Векторный процесс | SVG | `svg/vector-process.svg` |
| Направление: Executive Swiss | HTML 16:9 | `directions/executive-swiss.html` |
| Направление: Editorial Research | HTML 16:9 | `directions/editorial-research.html` |
| Направление: Data Studio | HTML 16:9 | `directions/data-studio.html` |
| Направление: Product Keynote | HTML 16:9 | `directions/product-keynote.html` |
| Направление: Teaching Lab с управляемыми размерами эмоджи | HTML 16:9 | `directions/teaching-lab-emoji.html` |
| Направление: Teaching Lab с предметным изображением | HTML 16:9 | `directions/teaching-lab-visuals.html` |
| Направление: Teaching Lab PPTX-safe с проверяемыми подсказками | HTML 16:9 | `directions/teaching-lab-pptx-safe.html` |

## Правила

- Любые цифры, подписи и тезисы в этих файлах являются заглушками.
- Примеры направлений показывают визуальную грамматику, а не готовые шаблоны.
- Пример Teaching Lab с эмоджи показывает систему размеров и ролей, а не разрешение украшать каждый слайд случайными эмоджи.
- Пример Teaching Lab с предметным изображением показывает, как отделить будущий PNG/JPG/WebP от редактируемых подписей, стрелок и учебного задания.
- Пример Teaching Lab PPTX-safe показывает кроссплатформенно-безопасный путь: разрешённые шрифты, UTF-8 meta и проверяемые учебные подсказки.
- PNG-превью намеренно не хранятся в навыке: их нужно получать свежими через `scripts/export_deck_png.mjs` или `scripts/verify.mjs`.
- SVG-пример показывает исходный векторный слайд. Он не обещает, что любую HTML-презентацию можно автоматически превратить в редактируемый SVG.
