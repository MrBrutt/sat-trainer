# Cards Without Grades Implementation Plan

**Goal:** a card asks the word's meaning (4 English meanings + «Не знаю»); the answer, not the student, sets when the word comes back.

**Architecture:** `answerCard(st, ok)` in `assets/vocab.js` turns a right/wrong answer into the SM-2 state. The option builder of the check before questions moves to `assets/meanings.js` and serves both the check and the cards. `vocab-ui.js` keeps the open card in `S.session.ask`.

**Spec (approved in chat 2026-11-10):**
- review word: right → «Помню» (`schedule(st, 3)`); wrong or «Не знаю» → «Не помню»: meaning and example shown, back in this session 4 cards later, then tomorrow;
- new word asked at first sight: right → it was known, back in 4 days (`schedule(st, 4)`); wrong or «Не знаю» → meaning shown, asked again 4 cards later; right then → tomorrow;
- tomorrow's load must not grow: not knowing a word never learned is not forgetting, so it costs no ease;
- right answers go on by themselves (650 ms, as in the check); a miss waits for «Дальше»;
- words without a meaning to show (no definition, or the meaning is the question itself) keep «Показать значение» with two buttons, «Не помню / Помню»;
- «Уже знаю это слово» stays; the stored card data does not change shape.

## Task 1: `answerCard(st, ok, now)` in assets/vocab.js
Tests in `tests/vocab.test.js`:
- new word right at first sight → `ivl` 4, due in 4 days;
- new word missed → due in a minute, `ease` unchanged (2.5), `lapses` 0;
- missed then right → `ivl` 1;
- learned word right → equals `schedule(st, 3)`; missed → equals `schedule(st, 1)` (ease drops).

## Task 2: `meaningOptions(card, siblings, pool)` and `meaningPool()` in assets/meanings.js
Moved from `prep.js` (prep imports them). Tests in `tests/meanings.test.js`: 4 distinct options with the card's meaning among them; wrong ones of the same part of speech when the pool has them; one wrong meaning from a sibling.

## Task 3: the card in assets/vocab-ui.js
`S.session.ask = {key, def, options, picked}`; `pick(i)` (`-1` = «Не знаю») records the answer at once, `next()` closes the card. Keys: 1–4 pick, Space «Не знаю», Enter «Дальше», K «знаю». Fallback keeps reveal + «Не помню / Помню» (keys 1, 2). README updated. Checked in the browser on the signed-out copy (port 8767).

## Changed the same day

The user found picking among four meanings too easy ("узнавание, а не вспоминание") and asking a new word before showing it pointless. Cards now: a new word is shown with its meaning and example (`v-learn`: back in a minute, no ease lost); a word met before is recalled, opened, and marked «Вспомнил» (→, 2) or «Не вспомнил» (←, 1) through `answerCard`. The four meanings stay only in the check before a question. Tests: "a card: see a new word, then recall it" in `tests/vocab-ui.test.js`.
