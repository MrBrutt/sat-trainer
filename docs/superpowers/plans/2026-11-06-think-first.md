# Think First Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In Words in Context questions the choices appear only after the student marks the clue word and writes their own word, the teacher's strategy made into steps.

**Architecture:** A new module `assets/think.js` holds clue detection (pure) and the step state per question. `app.js` shows its card in place of the choices while it is locked; answers carry what the student did, so the feedback can show it and the trainer can compare results with and without the steps.

**Tech Stack:** plain ES modules, no build step; browser tests in `tests/`, run by `scripts/test.sh`.

**Spec:** agreed in chat on 2026-11-06:
- Words in Context only: choices open after (1) marking the clue word in the text, when the sentence with the blank has one, and (2) writing one's own word, in any language. The trainer checks (1) against a list of signal words; it cannot judge (2) and only asks for it.
- A wrong clue does not block: the trainer names the right word and goes on.
- «Most nearly mean»: the word is covered in the text and the prompt until the student writes their own word.
- Errors in the sentences with a contrast word are the target: 10 of 18 right, against 13 of 18 with no clue word.

## Global Constraints

- UI text in Russian. The step counts as question time: the timer runs.
- Applies to first attempts, repeats of mistakes and «Решить заново» alike.
- No skip button: the point is that the step cannot be avoided.
- The check of words before a question (`prep`) comes first, unchanged.

## Review Focus

1. Answering by keyboard (A–D) while the choices are hidden does nothing. → `tests/think.test.js: the question stays closed until the student has written something`, plus a browser check of the keys.
2. A question shown as the original PDF has no text to tap: only the own-word step. → `tests/think.test.js: the original PDF view has no text to tap`.
3. A phrase such as «due to» must not make every «to» a right tap. → `tests/think.test.js: small words of a phrase do not count as the clue`.
4. «But also» is not a contrast. → `tests/think.test.js: "but also" adds, it does not contrast`.
5. On a phone a tap on a plain word must work: iOS fires delegated clicks only on `cursor: pointer` elements. → CSS and a check at 375 px.

---

### Task 1: Think first

**Files:**
- Create: `assets/think.js`, `tests/think.test.js`
- Modify: `assets/vocab.js` (export `sentences`), `assets/app.js`, `assets/today.js`, `assets/styles.css`, `tests/index.html`, `README.md`

**Interfaces:**
- Produces (`assets/think.js`): `clueWords(q) -> [{text, kind}]` (kind: "contrast" | "cause" | "same"); `coveredWord(q) -> string|null`; `stepStats(questions, progress) -> {steps: {n, ok}, before: {n, ok}}`; `createThink({esc, icon, answerOf, isOriginal, refresh}) -> {locked(q), html(q), decorate(q, root) -> boolean (words were wrapped), take(q) -> {own, clue?}, reset(id), onInput(e), go(), actions}`.
- An answer's record gains `own` (string) and `clue` (boolean, when there was a clue step).

- [ ] **Step 1: Write failing tests** for detection, the step flow, covering, decoration and stats in `tests/think.test.js`.
- [ ] **Step 2: `scripts/test.sh`** — Expected: FAIL (module missing).
- [ ] **Step 3: Implement `assets/think.js`, export `sentences`.**
- [ ] **Step 4: `scripts/test.sh`** — Expected: PASS.
- [ ] **Step 5: Wire into `app.js`:** the card replaces the choices while locked; `answer`, `strike` and `reveal` respect it; `record` carries `take(q)`; `retry` resets; feedback shows «Ваше слово»; Enter in the field goes on; Today's sidebar compares results with and without the steps.
- [ ] **Step 6: Verify in the browser at 375 px and wide:** a question with a clue (right and wrong tap), one without, «most nearly mean», keys A–D while locked, answer, retry, a repeat of a mistake.
- [ ] **Step 7: Commit, release, publish the artifact.**
