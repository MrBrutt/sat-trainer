# Clear Score Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The score says it counts first answers, and a mistake fixed on review no longer looks like a first-try right answer.

**Architecture:** `firstTryScore` in `assets/today.js` holds the numbers; `app.js` shows them and marks fixed cells.

**Tech Stack:** plain ES modules, no build step; browser tests run by `scripts/test.sh`.

**Spec:** agreed in chat on 2026-11-07 and 2026-11-09: fixed cells get their own look, a mark and the tooltip «Ошибка исправлена на повторе»; the label is «63% с первого раза», on hover «38 из 60 с первого раза, ещё 5 ошибок исправлены на повторе».

## Global Constraints

- The percentage itself does not change: first answers only.

## Review Focus

1. A question solved again with «Решить заново» after its mistake was fixed is not a fixed mistake any more. → `tests/today.test.js: only a first answer that was wrong counts as fixed`.
2. No answers yet: no percentage and no "0 из 0". → browser check.
3. A flagged and fixed cell shows both marks. → browser check.
4. The longer label must not push the top bar out of the window. → browser check at 1280 and 1000 px.
5. Light theme: the mark stays visible. → browser check.

---

### Task 1: Clear score

**Files:** Modify `assets/today.js`, `assets/app.js`, `assets/styles.css`, `tests/today.test.js`

**Interfaces:** Produces `firstTryScore(questions, progress, review) -> {answered, right, fixed, pct}`.

- [ ] **Step 1: Write failing tests** in `tests/today.test.js`.
- [ ] **Step 2: `scripts/test.sh`** — Expected: FAIL (no such export).
- [ ] **Step 3: Implement, wire into the top bar and the grid.**
- [ ] **Step 4: `scripts/test.sh`** — Expected: PASS.
- [ ] **Step 5: Verify in the browser on a signed-out copy, commit, release.**
