# Questions With a Chart or Table Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A question with a chart or table reads like any other question: only the figure is a picture, the passage, prompt, choices and explanation are normal text.

**Architecture:** A new module `assets/figure.js` finds the figure (everything above the passage's first line in the PDF) and draws regions as one block without the blank page margins. No new stored data: the cut is found when the question is shown, so nothing has to be imported again.

**Tech Stack:** plain ES modules, pdf.js, no build step; browser tests in `tests/`, run by `scripts/test.sh`.

**Spec:** agreed in chat on 2026-11-09:
- The explanation is always text. Its letters were cut because the text of saved PDFs starts at x=14.5 and the crop at 17.
- Only the chart or table stays a picture; the passage, prompt and choices are normal, and choices can be struck out.
- The "Оригинальная вёрстка" button stays and shows the question as one block, without a break between PDF pages.
- No new import; progress and question numbers do not change.

## Global Constraints

- In all 16 figure questions (Information and Ideas) the figure comes first and the passage is the last stem paragraph.
- A question that does not fit that pattern keeps the full original view.
- A canvas stays well under the iPhone limit of 16.7 million pixels.

## Review Focus

1. The passage's first line is not found in the PDF: the question must still show everything. → `tests/figure.test.js: a passage that is not found leaves the regions whole`.
2. The passage starts at the top of the second page: no empty picture for that page. → `tests/figure.test.js: a passage at the top of the next page drops that page`.
3. Two parts joined must not make the last and first line touch. → `tests/figure.test.js: parts are joined without their blank margins`.
4. A wide table on a phone: it scrolls sideways rather than shrinking to unreadable. → browser check at 375 px.
5. Words like the chart's labels must not appear as passage text. → `tests/figure.test.js: only the passage is text`, plus the check of all 16.

---

### Task 1: Figure questions

**Files:**
- Create: `assets/figure.js`, `tests/figure.test.js`
- Modify: `assets/app.js`, `assets/parser.js` (drop the rationale regions), `assets/styles.css`, `tests/index.html`, `README.md`

**Interfaces:**
- Produces (`assets/figure.js`): `passageOf(q) -> paragraph|null`; `groupLines(items) -> [{top, text}]`; `cutBefore(regions, lines, text) -> regions`; `stack(canvases) -> canvas`; `cropToInk(canvas) -> canvas`; `drawQuestion(pdf, q, cssWidth) -> canvas`; `drawFigure(pdf, q) -> canvas`.

- [ ] **Step 1: Write failing tests** in `tests/figure.test.js`.
- [ ] **Step 2: `scripts/test.sh`** — Expected: FAIL (module missing).
- [ ] **Step 3: Implement `assets/figure.js`.**
- [ ] **Step 4: `scripts/test.sh`** — Expected: PASS.
- [ ] **Step 5: Wire into `app.js`:** the explanation is text; a separable figure question shows the picture and the text; the original view is one block.
- [ ] **Step 6: Verify all 16 questions in the browser, wide and at 375 px, on a signed-out copy.**
- [ ] **Step 7: Commit, release.**
