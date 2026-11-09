# Obvious Words Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The trainer stops asking the student to learn obvious words such as "nineteenth", "farmworker" and "researcher".

**Architecture:** A hand-picked list in `assets/obvious-words.js`, built from the 1162 words the choices of the 430 questions flag as hard. `hardness()` in `assets/words.js` treats a listed word as common, so the check before a question, the cards and the underlines all agree.

**Tech Stack:** plain ES modules, no build step; browser tests run by `scripts/test.sh`.

**Spec:** agreed in chat on 2026-11-07 and 2026-11-09. A list, not rules: a rule on word parts also catches "hardship", "drawback", "overlook" and "thereby", which are real vocabulary.

## Global Constraints

- Every choice of a Words in Context question is still asked: there the word is the question.
- When in doubt a word stays on the check: a missing word costs more than an extra one.

## Review Focus

1. A plural or inflected form ("researchers") must count as the listed word. → `tests/words.test.js: plain words are not hard`.
2. A hyphenated word made of plain parts. → `tests/words.test.js: a hyphenated word of plain parts is plain`.
3. Real vocabulary built from common parts stays. → `tests/words.test.js: real vocabulary stays`.
4. Words in Context choices. → `tests/words.test.js: a choice of Words in Context is asked even if it is plain`.
5. A question whose only words were obvious opens at once. → browser check.

---

### Task 1: Obvious words

**Files:** Create `assets/obvious-words.js`, `tests/words.test.js`. Modify `assets/words.js`, `tests/index.html`.

- [ ] **Step 1: Write failing tests.**
- [ ] **Step 2: `scripts/test.sh`** — Expected: FAIL.
- [ ] **Step 3: Add the list, use it in `hardness()`.**
- [ ] **Step 4: `scripts/test.sh`** — Expected: PASS.
- [ ] **Step 5: Measure on the 430 questions, check in the browser, commit, release.**
