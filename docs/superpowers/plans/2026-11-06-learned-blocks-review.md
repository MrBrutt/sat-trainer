# Learned Words, Blocks and Code Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cards graduate to «выучено» sooner, questions can be switched by the four SAT blocks and their skills, and the whole code base is re-checked for errors.

**Architecture:** Graduation lives in `schedule()` (assets/vocab.js) as extra fields on a card's state, which the account already syncs. Blocks are a pure module (assets/domains.js) that the sidebar and the question filter read. The review goes through every module and fixes what it finds, each fix with a test that failed first.

**Tech Stack:** plain ES modules, no build step; browser tests in `tests/`, run by `scripts/test.sh` against the dev server on :8765.

**Spec:** agreed in chat on 2026-11-05/06:
- A word becomes «выучено» after three «Помню» or «Легко» in a row on different days; it then comes back about every 2–3 weeks; forgetting it makes it «изучаю» again. «Уже знаю это слово» stays as it is.
- Four blocks always visible, with subtopics and progress: Craft and Structure (Words in Context, Text Structure and Purpose, Cross-Text Connections); Information and Ideas (Central Ideas and Details, Command of Evidence, Inferences); Standard English Conventions (Boundaries; Form, Structure, and Sense); Expression of Ideas (Rhetorical Synthesis, Transitions). A block without questions explains how to add its PDF. The choice works together with the status and difficulty filters.
- Whole code re-checked; every error reproduced by a test, then fixed; a list of what was found and fixed goes to the student.

## Global Constraints

- UI text in Russian; skill and block names as College Board writes them.
- Existing users' cards have no new fields: they must keep working.
- Each task ships to the site when done (`python3 scripts/stamp.py`, commit, fast-forward main, push, wait for `version.json`), then to the artifact.
- A newly added block's PDFs are not available yet: parsing blocks 2–4 cannot be verified here and must be reported as unverified.

## Review Focus

1. Cards studied before this change (no new fields): a card with three passes behind it graduates on its next «Помню», and nothing crashes. → `tests/vocab.test.js: a card from before this change counts its earlier reviews`.
2. Two «Помню» on the same day count once. → `tests/vocab.test.js: two passes on one day count once`.
3. A saved filter from before blocks (`S.ui.skill` set, no `S.ui.domain`) still filters and highlights its block. → `tests/domains.test.js: a skill alone selects its block`.
4. A question whose PDF names a skill outside the four blocks (Math, an unknown skill) stays reachable. → `tests/domains.test.js: skills outside the four blocks get a group of their own`.
5. Choosing a block with a status filter that leaves no question: the empty state offers to clear filters and clearing also clears the block. → Task 2 browser step.

---

### Task 1: «Выучено» after three passes

**Files:**
- Modify: `assets/vocab.js` (`schedule`, `intervals`, `statusOf`), `assets/vocab-ui.js` (`grade`: toast)
- Test: `tests/vocab.test.js`

**Interfaces:**
- Produces: card state gains `good` (passes in a row, on different days), `goodDay` (start of the day of the last counted pass), `mastered` (boolean). `isMastered(st) -> boolean` is `st.mastered || st.ivl >= MASTERED_DAYS`, exported from vocab.js.
- Values: `GRADUATE = 3` passes; the pass that graduates waits at least 14 days («Помню») or 21 («Легко»); a graduated word then offers Сложно 7 д, Помню 21 д, Легко 30 д. «Не помню» clears `good`, `goodDay`, `mastered`. «Сложно» sets `good` to 0 but keeps `mastered`. A card without `good` starts from `reps`.

- [ ] **Step 1: Write failing tests** in `tests/vocab.test.js`: three passes on three days graduate; two passes on one day count once; «Сложно» breaks the run; «Не помню» on a graduated word gives status "learning"; a graduated word previews `["<1 мин", "7 д", "21 д", "30 д"]`; a card from before this change counts its earlier reviews; the existing "every answer waits longer" sweep still holds.
- [ ] **Step 2: `scripts/test.sh`** — Expected: those tests FAIL.
- [ ] **Step 3: Implement in `assets/vocab.js`; add a toast in `grade()` when a word graduates.**
- [ ] **Step 4: `scripts/test.sh`** — Expected: PASS. Check in the browser at 375 px that the word moves to «Выучено» in the sidebar.
- [ ] **Step 5: Commit, release.**

### Task 2: Four blocks and their skills

**Files:**
- Create: `assets/domains.js`
- Modify: `assets/app.js` (`matches`, `renderSidebar`, `setFilter`, actions, the `S.ui` resets), `assets/styles.css`
- Test: `tests/domains.test.js`

**Interfaces:**
- Produces (`assets/domains.js`): `DOMAINS: [{name, skills: [string]}]`; `domainOf(q) -> string` (by skill, then `q.domain`, then "Другое"); `outline(questions, progress) -> [{name, count, done, ok, skills: [{name, count, done, ok}]}]`, the four blocks first and always, then any others found; `inFocus(q, domain, skill) -> boolean`.
- `S.ui.domain` is "all" or a block name, next to `S.ui.skill`.

- [ ] **Step 1: Write failing tests** in `tests/domains.test.js`: all four blocks appear with no questions; counts, done and ok per block and skill; "command of evidence" variants fall into Information and Ideas; skills outside the four blocks get a group of their own; a skill alone selects its block; `inFocus` by block, by skill and for "all".
- [ ] **Step 2: `scripts/test.sh`** — Expected: FAIL (module missing).
- [ ] **Step 3: Implement `assets/domains.js`.**
- [ ] **Step 4: Sidebar:** «Все блоки», then the blocks with `решено/всего`, a split bar and, for the open block, its skills; a block with no questions opens a hint with the Question Bank steps and a button that adds a PDF; skills with no questions are disabled. `matches` and the sidebar counts use `inFocus`; every reset of `S.ui.skill` resets `S.ui.domain`.
- [ ] **Step 5: Verify in the browser at 375 px and on desktop:** block and skill switching, combination with status and difficulty, an empty block's hint, the empty filter state.
- [ ] **Step 6: Commit, release.**

### Task 3: Whole code review

**Files:** every module in `assets/`, `scripts/`, tests as needed.

- [ ] **Step 1: Read each module in full, in this order: sync, account, cloud, merge; vocab, vocab-ui, prep, words; today, timer; app; parser; assistant, size-test.** Note errors and illogical behavior with the input that triggers them.
- [ ] **Step 2: For each confirmed error: failing test (or a browser reproduction where the code cannot be loaded in a test), fix, `scripts/test.sh`.**
- [ ] **Step 3: Commit per fix, release.**
- [ ] **Step 4: Report to the student: what was found, what was fixed, what was left and why.**
