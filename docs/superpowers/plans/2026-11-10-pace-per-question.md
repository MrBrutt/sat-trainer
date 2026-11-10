# Pace Per Question Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The trainer stops pushing the student to rush: each question gets its own time norm, the clock is out of sight while solving, and a wrong answer given far faster than the norm is named as a likely rush.

**Architecture:** `paceFor(q)` in `assets/timer.js` becomes a norm from the length of the question; `rushed(q, p)` and `rushStats(questions, progress)` tell rushed mistakes. `app.js` and `today.js` show them.

**Tech Stack:** plain ES modules, no build step; browser tests run by `scripts/test.sh`.

**Spec:** agreed in chat on 2026-11-10 (the teacher's conclusion from the last mock: the student rushes):
- Norm = 25 s + 0.33 s per word of passage, prompt and choices, + 15 s with a chart or table; rounded to 5 s. The norms of a typical module add up to the SAT's 32 minutes for 27 questions. Math keeps 95 s.
- The running clock is hidden by default; time is still counted. It can be shown again in the settings on "Сегодня".
- After the answer: "1:05 на вопрос · норма для этого вопроса 1:35". A wrong answer faster than 60% of the norm: "Похоже на спешку: ошибка за 0:35 при норме 1:35".
- "Сегодня": "Ошибки в спешке: X из Y".

## Review Focus

1. A revealed answer ("Сдаться") is not a rushed mistake. → `tests/timer.test.js: giving up is not a rush`.
2. Answers without a time (old data) count nowhere. → `tests/timer.test.js: an answer without a time is not a rush`.
3. A student who showed the clock before keeps a working switch. → browser check of the setting.
4. Norms of a module add up to 32 minutes. → `tests/timer.test.js: an average question gets the SAT's average time`.
5. Math questions keep their pace. → `tests/timer.test.js: math keeps its pace`.

---

### Task 1: Pace per question

**Files:** Modify `assets/timer.js`, `assets/app.js`, `assets/today.js`; create `tests/timer.test.js`; modify `tests/index.html`.

- [ ] **Step 1: Write failing tests.**
- [ ] **Step 2: `scripts/test.sh`** — Expected: FAIL.
- [ ] **Step 3: Implement and wire.**
- [ ] **Step 4: `scripts/test.sh`** — Expected: PASS.
- [ ] **Step 5: Check the averages on the 430 questions and the screens, commit, release.**
