# Steps Before the Answer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "Think first" beyond Words in Context: in Transitions the student names the relation between the sentences and the trainer checks it; in Command of Evidence and Inferences the student writes what the answer must show before the choices appear.

**Architecture:** `assets/think.js` gains a kind per question (`wic`, `transition`, `claim`, `infer`); `relationOf(q)` maps the correct transition to one of five relations. `app.js` shows a note above the choices and the student's step in the feedback.

**Tech Stack:** plain ES modules, no build step; browser tests run by `scripts/test.sh`.

**Spec:** agreed in chat on 2026-11-10:
- Transitions: five relations (contrast or concession; continuation or likeness; cause and effect; example or detail; order in time or outcome), checked against the correct answer's transition; 43 of the 48 correct answers map, the rest are asked without a check.
- Command of Evidence, Inferences: the student writes what the answer must show, or their own ending; the feedback shows it next to the right answer.
- Boundaries: no step (cannot be checked).

## Global Constraints

- Russian UI text. No skip button. The step counts as question time.
- Applies to first attempts, reviews of mistakes and «Решить заново».

## Review Focus

1. Keys A–D while a step is open do nothing (existing guard on `think.locked`). → browser check.
2. A transition the map does not know: asked, not checked, no wrong verdict. → `tests/think.test.js: an unknown transition is asked without a verdict`.
3. A choice with punctuation ("However,") maps like the bare word. → `tests/think.test.js: relations of transitions`.
4. Boundaries and other skills keep no step. → `tests/think.test.js: other questions, and answered ones, have no steps`.
5. The step statistics count all kinds. → `tests/think.test.js: results with the steps are told from those before them`.

---

### Task 1: Steps before the answer

**Files:** Modify `assets/think.js`, `assets/app.js`, `assets/styles.css`, `tests/think.test.js`, `README.md`.

**Interfaces:** Produces `relationOf(q) -> "contrast"|"more"|"cause"|"example"|"time"|null`; `createThink(...)` gains `note(q)`, `feedback(q, pr)` and the action `think-rel`; `take(q)` returns `{rel, relOk?}` for Transitions.

- [ ] **Step 1: Write failing tests.**
- [ ] **Step 2: `scripts/test.sh`** — Expected: FAIL.
- [ ] **Step 3: Implement in `think.js`, wire into `app.js`.**
- [ ] **Step 4: `scripts/test.sh`** — Expected: PASS.
- [ ] **Step 5: Check in the browser (wide and 375 px), commit, release.**
