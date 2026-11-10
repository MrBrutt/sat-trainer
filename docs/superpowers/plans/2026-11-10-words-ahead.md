# Words Ahead Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The cards bring the words of the next questions a day or two before the student reaches them, so the question tests memory instead of the minute-old check.

**Architecture:** `gateRanks` in `assets/vocab-ui.js` ranks the words that open questions; `startSession` orders new cards by it.

**Tech Stack:** plain ES modules, no build step; browser tests run by `scripts/test.sh`.

**Spec:** agreed in chat on 2026-11-07, started 2026-11-10. New cards in this order: own words → choice words of mistakes waiting for review → choice words of questions ahead, the block in focus first, by number → other words of mistakes → other words of questions ahead → the rest. Found: the old order put all 159 words of mistakes (passage words too) first, so the next questions' words came 5–8 days late.

## Global Constraints

- The number of new cards a day does not change.
- The check before a question stays as it is.

## Review Focus

1. A mistake already fixed on review no longer needs its words urgently. → `tests/vocab-ui.test.js: words of a fixed mistake wait`.
2. A word shared by several questions takes its earliest place. → `tests/vocab-ui.test.js: a shared word takes its earliest place`.
3. Answered questions do not pull their words forward. → `tests/vocab-ui.test.js: answered questions pull nothing`.
4. Focus on one block puts its questions first. → `tests/vocab-ui.test.js: the block in focus comes first`.
5. Today's cards started already are not reshuffled. → unchanged `startSession` once a day; browser check.

---

### Task 1: Words ahead

**Files:** Modify `assets/vocab-ui.js`, `tests/vocab-ui.test.js`.

**Interfaces:** Produces `gateRanks(questions, gates, {progress, review, focus}) -> Map<key, {tier, n}>` (tier 1 mistakes waiting for review, tier 2 questions ahead).

- [ ] **Step 1: Write failing tests.**
- [ ] **Step 2: `scripts/test.sh`** — Expected: FAIL.
- [ ] **Step 3: Implement and use it in `startSession`.**
- [ ] **Step 4: `scripts/test.sh`** — Expected: PASS.
- [ ] **Step 5: Check today's order on a copy of the data, commit, release.**
