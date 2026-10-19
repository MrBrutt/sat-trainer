# Phone and Accounts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The trainer works on a phone, and a student signed in with Google sees the same questions, answers, words and mistakes on every device.

**Architecture:** localStorage and IndexedDB stay the working copy on each device. A sync engine does a three-way merge per section (the last synced copy is the base, so deletions and resets carry over) between the device and Firestore documents under `users/{uid}`. PDFs go to Firestore in ≤900 KB chunks. Sync runs only on the GitHub Pages site with a Firebase config; the claude.ai artifact never loads it.

**Tech Stack:** plain ES modules, no build step; Firebase JS SDK 12.6.0 from `https://www.gstatic.com/firebasejs/12.6.0/` (app, auth, firestore); tests in the browser at `/tests/`.

**Spec:** agreed in chat on 2026-10-18/19, summarized here:
- Phone: the progress file carries the PDFs; the start page has "Перенести прогресс с другого устройства" with a file picker that has no type filter (iOS greys out .json otherwise); screens checked at 375 px; keyboard hints hidden on touch screens.
- Accounts: "Войти через Google" on the start page and in the menu. Everything except UI state syncs: answers, flags, vocabulary (cards, own words, edits, known, level, test result), mistakes for review, activity, the PDFs and question numbers. Two devices never lose each other's work: per question and per word the latest attempt wins. Works offline; saves when back online. Topbar shows "Сохранено в аккаунте" / "Сохраняю…" / "Нет связи — сохраню позже". Without signing in the site works as now.
- Firebase project `sat-trainer` on the free Spark plan; Firestore rules: a user reads and writes only `users/{uid}/**`.

## Global Constraints

- No build step; new modules are ES modules under `assets/`, listed in the import map by `scripts/stamp.py` like the rest.
- UI text in Russian; nothing on the question screen reveals answer-choice meanings (see memory: words before a question).
- The artifact build (`window.claude` present) must not import Firebase or show account UI.
- Never store anything in Firestore outside `users/{uid}/`.
- Firestore document limit 1 MiB: PDF chunk size 900_000 bytes; each state section is one document.

## Review Focus

1. A page closed while offline after answering: the answers reach the account on the next visit (the base copy advances only after the server confirms a write). → `sync.test.js: unconfirmed write is pushed again on next start`.
2. Signing in on a device that already has its own progress: both sets of answers survive. → `sync.test.js: first sync unions both devices`.
3. "Сбросить прогресс" on one device clears the other device too instead of coming back from the account. → `sync.test.js: deletion on one device reaches the other`.
4. The claude.ai artifact and a site without config keep working with sync code present. → Task 5 step: open `artifact.html` locally with `window.claude` stubbed; no request to gstatic.com.
5. A new device signs in while the PDF is still uploading from another device: questions appear once the PDF arrives, no error screen. → `sync.test.js: sources wait for a missing pdf`.

---

### Task 1: Test page and three-way merge

**Files:**
- Create: `tests/index.html`, `tests/run.js` (tiny runner: `test(name, fn)`, `eq(a, b)`, prints pass/fail into the page and `window.__results`)
- Create: `assets/merge.js`
- Test: `tests/merge.test.js`

**Interfaces:**
- Produces (`assets/merge.js`): `same(a, b) -> boolean` (deep JSON equality); `mergeValue(b, l, r) -> any` (unchanged side takes the other; both changed → local); `mergeSet(b, l, r) -> array` (element-wise adds/removes from both); `mergeMap(b, l, r, resolve) -> object` (per key three-way; both changed → `resolve(l, r)`; changed vs deleted → changed one); `newer(field: (x) => number) -> resolve` (larger timestamp wins, local on tie).

- [ ] **Step 1: Write failing tests** — `mergeMap` keeps keys added on either side; deletion on one side with the other unchanged deletes; both changed picks larger `t`; `b` undefined (first sync) unions; `mergeSet` with b=[1,2], l=[1,2,3], r=[2] → [2,3]; `mergeValue` both changed → local.
- [ ] **Step 2: Open `http://localhost:8765/app/tests/` and see the tests fail** (module not found).
- [ ] **Step 3: Implement `assets/merge.js`.**
- [ ] **Step 4: Reload, all merge tests pass.**
- [ ] **Step 5: Commit** "Sync: three-way merge helpers with browser tests".

### Task 2: Progress file with PDFs, restore from the start page

**Files:**
- Modify: `assets/app.js` (`backupProgress`, `restoreProgress`, `showLanding`, new `installSources`)
- Test: `tests/backup.test.js`

**Interfaces:**
- Produces (`assets/app.js`, exported via a small `assets/setbuild.js` if app.js cannot be imported in tests): `installSources(list: [{id, fileName, importedAt}], numbers: {qid: n}, bytesOf: (id) => Promise<Uint8Array|null>, oldSkills?) -> Promise<set|null>` — parses each PDF in order with `addQuestions(acc, parsed, src, numbersMap)`, stores bytes under `pdfKey(id)`, returns the finished set (sources whose bytes are missing are skipped).
- Backup JSON gains `pdfs: [{id, fileName, importedAt, data: base64}]` and `numbers: {qid: n}`; `version` becomes 2. Version-1 files still restore.

- [ ] **Step 1: Failing test** — base64 round trip of a 3 MB Uint8Array through the backup encoder/decoder (`toB64`, `fromB64` in `assets/setbuild.js`) is byte-identical and takes < 1 s.
- [ ] **Step 2: See it fail; implement `toB64`/`fromB64` (chunked `String.fromCharCode`, `atob`).**
- [ ] **Step 3: Backup writes `pdfs` and `numbers`; restore with no set on the device calls `installSources`, then merges progress as today and opens the trainer. Restore with a set merges progress only and adds PDFs it lacks.**
- [ ] **Step 4: Start page: a secondary button "Перенести прогресс с другого устройства" over a hidden `<input type=file>` without `accept`; picking a PDF there still imports it. After a restore of a version-1 file without questions the landing says "Прогресс загружен: N ответов. Теперь выберите PDF с вопросами."**
- [ ] **Step 5: Verify in the browser at 375×812:** clean storage → restore a file saved from a session with the real PDF → trainer opens with the same question numbers and answer count. Old file `sat-trainer-progress-2026-10-18.json` → message above, then PDF → 49 answers shown.
- [ ] **Step 6: Commit** "Phone: progress file carries the PDFs; restore from the start page".

### Task 3: Phone screens

**Files:**
- Modify: `assets/styles.css`, and whichever screen code a check shows broken

- [ ] **Step 1: At 375×812 screenshot: question with choices, words-before-question list and its check, cards, card grading buttons, size test, menu, Today.** Note every overflow, overlap or unreachable control.
- [ ] **Step 2: Hide keyboard hints on touch screens:** `@media (hover: none) and (pointer: coarse) { kbd { display: none } }`, keeping layouts that place `kbd` absolutely intact.
- [ ] **Step 3: Fix each noted issue; re-screenshot the same screens.**
- [ ] **Step 4: Commit** "Phone: screens fit 375 px, no keyboard hints on touch".

### Task 4: Sync engine

**Files:**
- Create: `assets/sync.js`
- Test: `tests/sync.test.js` (two fake devices sharing one fake adapter)

**Interfaces:**
- Consumes: `assets/merge.js`.
- Produces: `createSync({ adapter, sections, base, onStatus }) -> { start(): Promise, notify(name), stop(), status }` where
  - `adapter = { get(name) -> Promise<value|undefined>, set(name, value) -> Promise (resolves on server confirm), watch(name, cb(value)) -> unsubscribe, online() -> boolean }`;
  - `sections = { [name]: { read() -> value, apply(value), merge(b, l, r) -> value } }`;
  - `base = { get(name), set(name, value) }` (persisted by the caller);
  - `onStatus(state)` with state `"saving" | "saved" | "offline" | "error"`.
  - Rules: merge on start, on every remote value, and 1.5 s after `notify`; apply locally only if the merge differs from local; write remotely only if it differs from remote; `base.set` only after `adapter.set` resolves; echoes of own pending writes are ignored.

- [ ] **Step 1: Failing tests:** first sync unions both devices; an answer on device A appears on B after B's watch fires; deletion on one device reaches the other; unconfirmed write is pushed again on next start (adapter.set never resolves, then a new engine with the same base and local starts); both devices answer the same question → the later `t` wins on both.
- [ ] **Step 2: See them fail; implement `assets/sync.js`; all pass.**
- [ ] **Step 3: Commit** "Sync: engine that merges each section with the account".

### Task 5: Google sign-in and syncing the trainer's data

**Files:**
- Create: `assets/cloud.js` (Firebase adapter), `assets/cloud-config.js` (the project's public `firebaseConfig`), `assets/account.js` (sections over `S`, UI)
- Modify: `assets/app.js` (`ls.set` hook → `account.notify(section)`; menu items; landing button; wipe signs out), `assets/styles.css`

**Interfaces:**
- Produces (`assets/cloud.js`): `loadCloud(config) -> Promise<{ signIn(), signOut(), onUser(cb(user|null)), adapter(uid), putPdf(uid, id, bytes), getPdf(uid, id) -> Uint8Array|null }>`; documents `users/{uid}/state/{section}` as `{ v: value, at }`; PDFs `users/{uid}/pdfs/{id}` = `{ n, size }` and `users/{uid}/pdfs/{id}/chunks/{i}` = `{ data: Bytes }`.
- Produces (`assets/account.js`): `createAccount(ctx) -> { init(), notify(key), html.topbar(), html.landing(), actions }`. Sections: `progress` (`mergeMap` newer by `t`), `review` (newer by `last || added`), `flags` (`mergeSet`), `vocab` (`srs` newer by `last`; `user`, `edits` `mergeMap` local on conflict; `known` `mergeSet`; `test` newer by `at`; other fields `mergeValue`), `activity` (`days` per field max as in `today.merge`; `unlocked` `mergeSet`; `bestRun`, `bestStreak` max; others `mergeValue`). Base and uid kept in `localStorage["sat-trainer:sync:v1"]`; a different uid starts with an empty base.
- Sign-in: `signInWithPopup(GoogleAuthProvider)`; errors shown as a toast in Russian. Firebase is imported only after a click on "Войти" or when the stored sync record has a uid; never when `window.claude` exists.

- [ ] **Step 1: Put the user's `firebaseConfig` in `assets/cloud-config.js`.**
- [ ] **Step 2: Implement `cloud.js`, `account.js` and the app hooks; topbar status chip and menu items "Войти через Google" / "Выйти (email)".**
- [ ] **Step 3: Verify:** site without sign-in makes no request to gstatic.com; `artifact.html` with `window.claude` stubbed shows no account UI; menu sign-in opens the Google popup (the student signs in themselves).
- [ ] **Step 4: Commit** "Accounts: sign in with Google and keep progress in sync".

### Task 6: Questions and PDFs in the account

**Files:**
- Modify: `assets/account.js` (section `sources`), `assets/app.js` (`runImport`, load-replace, `installSources` reuse)
- Test: `tests/sync.test.js` (sources apply with a fake `getPdf`)

**Interfaces:**
- Section `sources` = `{ list: { [id]: {fileName, importedAt} }, numbers: {qid: n} }`, merged with `mergeMap` (local on conflict) for both maps. Before a local list with a new id is pushed, its PDF is uploaded with `putPdf`. `apply` downloads missing PDFs with `getPdf`, then rebuilds the set with `installSources`; an id whose PDF is not there yet is skipped and retried on the next remote value.

- [ ] **Step 1: Failing test:** sources wait for a missing pdf (apply with `getPdf` → null keeps the old set; after the pdf appears the next apply builds the set).
- [ ] **Step 2: Implement; tests pass; check locally that importing a PDF while signed in calls `putPdf`.**
- [ ] **Step 3: Commit** "Accounts: questions and PDFs follow the student".

### Task 7: Ship

- [ ] **Step 1: Update README (accounts, privacy text: data leaves the device only when signed in) and the landing privacy line.**
- [ ] **Step 2: `python3 scripts/stamp.py`, run `/tests/`, commit, push, wait for `version.json`, publish the artifact (only changed shared files; no Firebase in it).**
- [ ] **Step 3: The student signs in on the MacBook and the phone; compare answer count, cards due today and the mistakes list.**
