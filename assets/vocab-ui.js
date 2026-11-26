// Vocabulary screens: flashcards with spaced repetition, word list, and "add word from text".
import { buildDeck, schedule, answerCard, readyIndex, requeue, statusOf, isMastered, termKey, lookup, makeExample, startOfDay, fmtDays } from "./vocab.js";
import { createSizeTest } from "./size-test.js";
import { LEVELS, levelZipf, loadFrequencies, loadDefs, defOf, defsPool, wordsReady, hardWordsIn, spoilerWords, passageText, buildTextDeck, choiceWords, DERIVED } from "./words.js";
import { inFocus } from "./domains.js";
import { noStyles } from "./meanings.js";

const DAY = 86400000;
const STATUS_LABEL = { new: "новое", learning: "изучаю", mastered: "выучено", known: "знаю" };
const ROLE_LABEL = { answer: "правильный ответ", target: "слово из текста", distractor: "неверный вариант", mine: "моё слово", text: "слово из текста", choice: "слово из вариантов ответа" };
const DEF_SRC = { sat: "", dict: "из Wiktionary", ai: "объяснение Claude", user: "моё определение" };

// The words that open questions, ranked for the new cards: {tier, n} by word. Tier 1 opens a mistake
// waiting for review; tier 2 a question not answered yet, those of the block in focus first, then by
// number. The cards run ahead of the questions, so a word is met a day or more before its question.
export function gateRanks(questions, gates, { progress, review, focus }) {
  const ranks = new Map();
  const put = (key, tier, n) => {
    const r = ranks.get(key);
    if (!r || tier < r.tier || (tier === r.tier && n < r.n)) ranks.set(key, { tier, n });
  };
  for (const q of questions) {
    const p = progress[q.id];
    const tier = !p ? 2 : !p.ok && !review[q.id]?.done ? 1 : 0;
    if (!tier) continue;
    const n = tier === 2 && !focus(q) ? 1e6 + q.n : q.n;
    for (const key of gates.get(q.id) || []) put(key, tier, n);
  }
  return ranks;
}

// A finger's move across a card (2026-11-20, phones and iPads): "right", "left" or null. It counts when
// it goes far enough (a quarter of the card) or is a quick flick, and goes more across than down,
// so scrolling the page is never taken for a swipe.
export function swipeOutcome({ dx, dy, ms, width }) {
  if (Math.abs(dx) < 1.5 * Math.abs(dy)) return null;
  const far = Math.abs(dx) >= Math.max(70, width * 0.28);
  const flick = Math.abs(dx) >= 40 && Math.abs(dx) / Math.max(ms, 1) >= 0.6;
  return far || flick ? (dx > 0 ? "right" : "left") : null;
}

// A question's sentence on a card, cut to the words around the word: a whole passage sentence made
// cards slow on a phone (2026-11-20). A tap shows it whole.
export function trimAround(before, after, words = 10) {
  const b = before.match(new RegExp(`(?:\\S+\\s+){0,${words}}\\S*$`))[0];   // "…risk-" + disclosure keeps its part
  const a = after.match(new RegExp(`^\\s*(?:\\S+(?:\\s+|$)){0,${words}}`))[0].replace(/\s+$/, "");
  const cutB = b.trim().length < before.trim().length, cutA = a.trim().length < after.trim().length;
  return { before: (cutB ? "…" : "") + b, after: a + (cutA ? "…" : ""), cut: cutB || cutA };
}

export const VOCAB_DEFAULT = () => ({ srs: {}, user: {}, edits: {}, known: [], daily: { date: "", newCount: 0, extra: 0 }, newPerDay: 20, level: "middle" });

export function createVocab(ctx) {
  const { S, $, icon, esc, toast, ls, KEY, plural } = ctx;
  const dict = ls.get(KEY.dict, {});
  const pendingLookups = new Set();
  const failedLookups = new Set();
  let auto = [];
  let textDeck = [];          // hard words from the passages and choices, once word frequencies are loaded
  let gates = new Map();      // question id → words of its answer choices that open the question
  let loaded = false;         // word frequencies and definitions are in
  let cache = null;           // cards built during the current render pass
  let addOpen = false;
  let openRow = null;
  let waitTimer = null;        // counts down while every card left is waiting out its minutes
  let builtFor = null;         // the level the word lists were built for

  const save = () => { cache = null; ls.set(KEY.vocab, S.vocab); };
  const saveDict = () => { cache = null; ls.set(KEY.dict, dict); };
  const today = () => new Date().toDateString();
  const words = (n) => `${n} ${plural(n, "слово", "слова", "слов")}`;

  function daily() {
    if (S.vocab.daily.date !== today()) S.vocab.daily = { date: today(), newCount: 0, extra: 0 };
    return S.vocab.daily;
  }

  function rebuild() {
    auto = S.set ? buildDeck(S.set.questions) : [];
    textDeck = [];
    gates = new Map();
    loaded = false;
    if (!S.set) return;
    Promise.all([loadFrequencies(), loadDefs()]).then(() => {
      if (!S.set) return;
      rebuildWords();
      loaded = true;
      // the first screen draws before the lists are in: today's cards are chosen again, unless started
      if (S.session && !S.session.reviewed && !S.session.revealed) S.session = null;
      ctx.refreshChrome();
      if (S.ui.view === "vocab") { renderSidebar(); renderMain(); }
      else if (S.ui.view === "questions") ctx.refreshTrainer();
    });
  }

  // Below this frequency a word counts as hard: the chosen level, or the size test's result.
  const threshold = () => (S.vocab.level === "test" && S.vocab.test?.zipf) || levelZipf(S.vocab.level);

  // Words that depend on the learner's level: hard words of the texts and of the choices.
  // A word now learned on its base word's card (attributable → attribute) brings its progress along:
  // the base word takes the record if it has none of its own; «знаю» carries over too.
  function adoptDerived() {
    let changed = false;
    const known = new Set(S.vocab.known);
    for (const [d, b] of Object.entries(DERIVED)) {
      if (S.vocab.srs[d] && !S.vocab.srs[b]) { S.vocab.srs[b] = S.vocab.srs[d]; changed = true; }
      if (known.has(d) && !known.has(b)) { known.add(b); changed = true; }
    }
    if (changed) { S.vocab.known = [...known]; save(); }
  }

  function rebuildWords() {
    adoptDerived();
    const level = threshold();
    builtFor = level;
    textDeck = buildTextDeck(S.set.questions, level);
    gates = new Map(S.set.questions.map((q) => [q.id, choiceWords(q, level)]));
  }

  // Every word of the deck, shaped for display (spoiler-free for questions not answered yet).
  // A render asks for the cards many times; they are built once per pass.
  function allCards() {
    if (cache) return cache;
    cache = buildCards();
    queueMicrotask(() => { cache = null; });
    return cache;
  }
  const cardMap = () => allCards().byKey;

  function buildCards() {
    const map = new Map();
    for (const c of auto) map.set(c.key, { ...c, examples: [...c.examples] });
    for (const c of textDeck) {
      const have = map.get(c.key);
      if (!have) map.set(c.key, { ...c, examples: [...c.examples], qids: [...c.qids] });
      else { have.examples.push(...c.examples); have.qids = [...new Set([...have.qids, ...c.qids])]; }
    }
    for (const u of Object.values(S.vocab.user)) {
      const c = map.get(u.key);
      if (c) { c.examples = [...u.examples, ...c.examples]; c.mine = true; }
      else map.set(u.key, { ...u, examples: [...u.examples], mine: true });
    }
    const known = new Set(S.vocab.known);
    const now = Date.now();
    for (const c of map.values()) {
      // Learn words before the questions, but keep each question unspoiled until it is answered:
      // its sentence (with the answer filled in), its number and the word's role stay hidden.
      c.practiced = c.qids.some((id) => S.progress[id]);
      const shown = c.examples.filter((x) => x.own || x.safe || !x.qid || S.progress[x.qid]);
      c.hiddenExamples = c.examples.length - shown.length;
      c.examples = shown;
      // "What does the word X most nearly mean": the meaning of X is the question itself
      c.hideDef = c.role === "target" && !c.practiced;
      const e = S.vocab.edits[c.key] || {};
      const own = defOf(c.key);
      const d = dict[c.key];
      c.note = e.note || "";
      c.def = null; c.pos = ""; c.sample = ""; c.defSrc = null;
      if (c.hideDef) { /* shown after the question is answered */ }
      else if (e.def) { c.def = e.def; c.defSrc = "user"; }
      else if (own) { c.def = own.d; c.pos = own.p; c.sample = own.x; c.defSrc = "sat"; }
      else if (d) { c.def = noStyles(typeof d === "string" ? d : d.d); c.defSrc = typeof d === "string" ? "dict" : d.s || "dict"; }
      c.st = S.vocab.srs[c.key] || null;
      c.known = known.has(c.key);
      c.status = statusOf(c.st, c.known);
      // Learned = remembered since the last slip and not due again yet. A word whose review day has
      // come may be forgotten, so its questions wait until it is recalled again.
      c.review = !c.known && (c.st?.reps || 0) > 0 && c.st.due <= now;
      c.ready = c.known || ((c.st?.reps || 0) > 0 && !c.review);
      c.n = c.qnum ?? 9999;
    }
    const list = [...map.values()];
    list.byKey = map;
    return list;
  }

  const cards = allCards;

  // Own words first; then the words that open questions (gateRanks); then the other words of
  // questions answered wrong, of the questions ahead, and the rest. Within a question the choices
  // come in a fixed shuffled order, so the answer is never first.
  const mix = (k) => { let h = 2166136261; for (const ch of k) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };
  function rankOf(c, ranks) {
    if (c.mine) return { tier: 0, n: 0 };
    const r = ranks.get(c.key);
    if (r) return r;
    if (c.qids.some((id) => S.progress[id] && !S.progress[id].ok)) return { tier: 3, n: c.n };
    return { tier: c.qids.some((id) => !S.progress[id]) ? 4 : 5, n: c.n };
  }

  function counts(all = cards()) {
    const now = Date.now();
    const due = all.filter((c) => !c.known && c.st?.last && c.st.due <= now);
    const fresh = all.filter((c) => !c.known && !c.st?.last);
    const mineFresh = fresh.filter((c) => c.mine);
    const autoFresh = fresh.filter((c) => !c.mine);
    const d = daily();
    const newLeft = Math.max(0, S.vocab.newPerDay + (d.extra || 0) - d.newCount);
    return { all, due, fresh, mineFresh, autoFresh, newLeft, newToday: mineFresh.length + Math.min(newLeft, autoFresh.length) };
  }

  // The card on screen stays first when today's cards are put together again (2026-11-20: a reload
  // after an update, or words from another device, rebuilt the session with a word that had come due
  // in front, and the card being read went back). Kept on this device for the day, turned as it was.
  let front = (ctx.KEY?.cardFront && ls.get(ctx.KEY.cardFront, null)) || null;   // { day, key, revealed }
  function rememberFront(s) {
    if (!loaded) return;   // the first screen, drawn before the word lists, is a stand-in: it says nothing
    const next = { day: today(), key: s.queue[0] || null, revealed: !!s.revealed };
    if (front && front.day === next.day && front.key === next.key && front.revealed === next.revealed) return;
    front = next;
    if (ctx.KEY?.cardFront) ls.set(ctx.KEY.cardFront, front);
  }

  // Today's cards: the open session, plus words that came due after it started (a word missed in a
  // check before a question comes back a minute later). Every counter on screen reads from here.
  function todayCards() {
    if (S.session && S.session.day !== today()) S.session = null;
    if (!S.session) startSession();
    const s = S.session;
    const all = cards();
    const byKey = all.byKey;
    s.queue = s.queue.filter((k) => byKey.has(k) && !byKey.get(k).known);
    const inQueue = new Set(s.queue);
    const now = Date.now();
    for (const c of all) if (!c.known && c.st?.last && c.st.due <= now && !inQueue.has(c.key)) s.queue.push(c.key);
    // a word just missed waits out its minutes while the cards behind it go first
    if (!s.revealed) {
      const i = readyIndex(s.queue, (k) => byKey.get(k).st, now);
      if (i > 0) s.queue.unshift(...s.queue.splice(i, 1));
      s.waitUntil = i < 0 && s.queue.length ? Math.min(...s.queue.map((k) => byKey.get(k).st.due)) : 0;
    }
    rememberFront(s);
    const fresh = s.queue.filter((k) => !byKey.get(k).st?.last).length;
    return { s, all, byKey, fresh, review: s.queue.length - fresh };
  }

  function dueTotal() {
    if (!S.set) return 0;
    return todayCards().s.queue.length;
  }

  function startSession() {
    const { due, mineFresh, autoFresh, newLeft } = counts();
    due.sort((a, b) => a.st.due - b.st.due);
    const ranks = gateRanks(S.set.questions, gates, { progress: S.progress, review: S.review || {}, focus: (q) => inFocus(q, S.ui.domain, S.ui.skill) });
    const rank = new Map(autoFresh.map((c) => [c.key, rankOf(c, ranks)]));
    autoFresh.sort((a, b) => rank.get(a.key).tier - rank.get(b.key).tier || rank.get(a.key).n - rank.get(b.key).n
      || (b.zipf || 0) - (a.zipf || 0) || mix(a.key) - mix(b.key));
    const fresh = autoFresh.slice(0, newLeft).map((c) => c.key);
    let queue = [...due.map((c) => c.key), ...mineFresh.map((c) => c.key), ...fresh];
    // the card that was on screen goes first again, if it is still to be studied today
    const keep = front?.day === today() ? front.key : null;
    const c = keep && cardMap().get(keep);
    let revealed = false;
    if (c && !c.known && (queue.includes(keep) || !c.st?.last || c.st.due < startOfDay() + DAY)) {
      if (!queue.includes(keep) && !c.st?.last && fresh.length) queue.splice(queue.lastIndexOf(fresh[fresh.length - 1]), 1);   // a new word in place of another, not on top
      queue = [keep, ...queue.filter((k) => k !== keep)];
      revealed = !!front.revealed && !!c.st?.last;
    }
    S.session = { queue, revealed, reviewed: 0, learnedNew: 0, day: today() };
  }

  // Words the trainer has no definition for: Wiktionary, or Claude inside claude.ai (the page cannot
  // reach other sites there). A choice word gets a general definition, not one fitted to a passage.
  function fetchDef(c, after) {
    if (c.def || c.hideDef || defOf(c.key) || dict[c.key] !== undefined || pendingLookups.has(c.key)) return;
    const viaClaude = ctx.inClaude();
    if (viaClaude && !ctx.ai()?.available()) return;
    failedLookups.delete(c.key);
    pendingLookups.add(c.key);
    const ex = c.examples?.[0];
    const find = viaClaude ? ctx.ai().define(c.term, ex ? ex.before + (ex.term ?? c.term) + ex.after : "") : lookup(c.term);
    find.then((res) => {
      pendingLookups.delete(c.key);
      if (res === undefined) { failedLookups.add(c.key); after?.(); return; } // offline: try again next time
      dict[c.key] = !res ? "" : { d: res, s: viaClaude ? "ai" : "dict" };
      saveDict();
      after?.();
      if (S.ui.view !== "vocab") return;
      if ((S.ui.vtab || "study") === "list") refreshList(); else renderMain();
    });
  }

  // ---------------------------------------------------------------- small pieces

  const statusBadge = (c) => `<span class="spill s-${c.status}">${STATUS_LABEL[c.status]}</span>`;

  function when(c) {
    if (c.known) return "знаю";
    if (!c.st?.last) return "новое";
    const days = Math.round((c.st.due - startOfDay()) / DAY);
    if (c.st.due <= Date.now() || days <= 0) return "сегодня";
    return `через ${fmtDays(days)}`;
  }

  const laterHtml = (c) => (c.hiddenExamples ? `<p class="ex-later">${icon("lock", "icon-sm")} Пример из вопроса появится, когда вы его решите — чтобы слово не подсказывало ответ.</p>` : "");
  const sourceHtml = (e) => `${e.kind === "rationale" ? "из разбора" : "из текста"}${e.n ? ` · <button class="linkish" data-action="v-open-q" data-id="${esc(e.qid)}">вопрос ${e.n} →</button>` : ""}`;

  function examplesHtml(c, limit = 2) {
    const later = laterHtml(c);
    if (!c.examples.length) return later;
    return `${later}<div class="examples">${c.examples.slice(0, limit).map((e) => `
      <figure class="ex">
        <blockquote>${esc(e.before)}<mark>${esc(e.term || c.term)}</mark>${esc(e.after)}</blockquote>
        <figcaption>${sourceHtml(e)}</figcaption>
      </figure>`).join("")}</div>`;
  }

  // On a card being studied: one sentence from a question, cut to the words around the word; a tap
  // shows the sentences whole (2026-11-20: whole passage sentences made cards slow on a phone).
  function cardExamplesHtml(c, s) {
    if (s.fullEx === c.key || !c.examples.length) return examplesHtml(c);
    const e = c.examples[0];
    const t = trimAround(e.before, e.after);
    const more = t.cut || c.examples.length > 1;
    return `${laterHtml(c)}<div class="examples"><figure class="ex">
        <blockquote>${esc(t.before)}<mark>${esc(e.term || c.term)}</mark>${esc(t.after)}</blockquote>
        <figcaption>${sourceHtml(e)}${more ? ` · <button class="linkish" data-action="v-ex-full">${t.cut ? "целиком" : "ещё пример"}</button>` : ""}</figcaption>
      </figure></div>`;
  }

  function defHtml(c) {
    if (c.hideDef) return `<div class="flash-def muted">${icon("lock", "icon-sm")} Значение откроется, когда вы решите вопрос про это слово</div>`;
    if (c.def) {
      return `<div class="flash-def">${c.pos ? `<span class="pos">${esc(c.pos)}</span> ` : ""}${esc(c.def)}</div>
        ${c.sample ? `<p class="flash-sample">${esc(c.sample)}</p>` : ""}
        ${DEF_SRC[c.defSrc] ? `<div class="def-src">${DEF_SRC[c.defSrc]}</div>` : ""}`;
    }
    if (dict[c.key] === "") return `<div class="flash-def muted">Определение не найдено — впишите своё в заметку ниже</div>`;
    if (ctx.inClaude() && !ctx.ai()?.available()) return `<div class="flash-def muted">Определения нет — впишите своё в заметку ниже</div>`;
    if (failedLookups.has(c.key)) return `<div class="flash-def muted">Не удалось загрузить определение (нет сети?) — попробую ещё раз позже</div>`;
    return `<div class="flash-def muted">Ищу определение в словаре…</div>`;
  }

  // ---------------------------------------------------------------- sidebar

  function renderSidebar() {
    const { all, fresh: newToday, review: dueN } = todayCards();
    const by = (st) => all.filter((c) => c.status === st).length;
    const tab = S.ui.vtab || "study";
    const filter = S.ui.vfilter || "all";
    const filters = [["all", "Все", all.length], ["new", "Новые", by("new")], ["learning", "Изучаю", by("learning")],
      ["mastered", "Выучено", by("mastered")], ["known", "Знаю", by("known")], ["mine", "Мои", all.filter((c) => c.mine).length]];
    const total = all.length || 1;
    const seg = (st, cls) => `<span class="${cls}" style="width:${(by(st) / total) * 100}%"></span>`;
    const side = $("#sidebar");
    if (!side) return;
    side.innerHTML = `
      <div>
        <div class="side-label">Сегодня</div>
        <div class="vtoday">
          <div><b>${dueN}</b><span>повторить</span></div>
          <div><b>${newToday}</b><span>новых</span></div>
        </div>
        <button class="btn btn-primary vstart" data-action="v-tab" data-tab="study">${icon("cards", "icon-sm")} Учить</button>
      </div>
      <div>
        <div class="side-label">Раздел</div>
        <div class="skill-list">
          <button class="skill-item ${tab === "study" ? "active" : ""}" data-action="v-tab" data-tab="study">${icon("cards", "icon-sm")}<span class="name">Карточки</span></button>
          <button class="skill-item ${tab === "list" ? "active" : ""}" data-action="v-tab" data-tab="list">${icon("list", "icon-sm")}<span class="name">Все слова</span><span class="count">${all.length}</span></button>
        </div>
      </div>
      <div>
        <div class="side-label">Список слов</div>
        <div class="chips">${filters.map(([k, label, n]) => `
          <button class="chip ${tab === "list" && filter === k ? "active" : ""}" data-action="v-filter" data-filter="${k}">${label}<span class="count">${n}</span></button>`).join("")}
        </div>
      </div>
      <div>
        <div class="side-label">Прогресс</div>
        <div class="stack-bar">${seg("mastered", "m")}${seg("known", "k")}${seg("learning", "l")}</div>
        <div class="legend">
          <span><i class="m"></i>выучено ${by("mastered")}</span><span><i class="k"></i>знаю ${by("known")}</span>
          <span><i class="l"></i>изучаю ${by("learning")}</span><span><i></i>новые ${by("new")}</span>
        </div>
      </div>
      <div>
        <div class="side-label">Мой уровень английского</div>
        <div class="chips">${[...LEVELS, ...(S.vocab.test?.zipf ? [{ id: "test", label: "По тесту" }] : [])].map((l) => `
          <button class="chip ${(S.vocab.level || "middle") === l.id ? "active" : ""}" data-action="v-level" data-level="${l.id}">${l.label}</button>`).join("")}
        </div>
        <p class="side-hint">От уровня зависит, какие слова в текстах и вариантах ответа считаются трудными — и какие нужно выучить перед вопросом.</p>
        ${S.vocab.test ? `<p class="side-hint">Тест: ≈ ${S.vocab.test.size.toLocaleString("ru-RU")} слов · ${new Date(S.vocab.test.at).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}</p>` : ""}
        <button class="btn btn-outline btn-sm side-btn ${tab === "test" ? "active" : ""}" data-action="v-tab" data-tab="test">${icon("target", "icon-sm")} ${S.vocab.test ? "Пройти тест ещё раз" : "Тест словарного запаса · 5 мин"}</button>
      </div>
      <div>
        <div class="side-label">Новых слов в день</div>
        <div class="chips">${[10, 20, 30, 50].map((n) => `
          <button class="chip ${S.vocab.newPerDay === n ? "active" : ""}" data-action="v-perday" data-n="${n}">${n}</button>`).join("")}
        </div>
      </div>
      <div class="side-foot">
        <span>${icon("bulb", "icon-sm")} Выделите незнакомое слово в тексте вопроса или разборе — появится кнопка «В словарь».</span>
      </div>`;
  }

  // ---------------------------------------------------------------- main

  function renderMain(scrollTop = false) {
    const main = $("#main");
    if (!main) return;
    const tab = S.ui.vtab || "study";
    // compact section switch for phones, where the sidebar is hidden in a drawer
    const seg = `<div class="vseg" role="tablist">
      <button class="${tab === "study" ? "active" : ""}" data-action="v-tab" data-tab="study">${icon("cards", "icon-sm")} Карточки</button>
      <button class="${tab === "list" ? "active" : ""}" data-action="v-tab" data-tab="list">${icon("list", "icon-sm")} Все слова</button>
    </div>`;
    main.innerHTML = tab === "test" ? sizeTest.html() : seg + (tab === "list" ? listHtml() : undoHtml() + studyHtml());
    if (document.getElementById("v-wait")) startWait();
    if (scrollTop) window.scrollTo({ top: 0 });
    ctx.ai()?.follow();
  }

  // After K: which word left, and the way to bring it back.
  function undoHtml() {
    const key = S.session?.undo?.key;
    if (!key) return "";
    return `<div class="vwrap"><div class="undo-bar" role="status">
      <span>«${esc(cardMap().get(key)?.term || key)}» — в «Знаю», из повторений убрано</span>
      <button class="btn btn-outline btn-sm" data-action="v-undo-known">${icon("rotate", "icon-sm")} Вернуть <kbd>Z</kbd></button>
    </div></div>`;
  }

  function studyHtml() {
    const all = cards();
    if (!all.length) {
      return `<div class="vwrap"><div class="empty"><h3>Словарь пуст</h3>
        <p>В этом наборе нет вопросов Words in Context. Добавляйте слова сами: выделите слово в тексте вопроса.</p></div></div>`;
    }
    const { s, byKey, fresh: newInQueue } = todayCards();
    if (!s.queue.length) return doneHtml(all);
    if (s.waitUntil && !s.revealed) return waitHtml(s);
    const c = byKey.get(s.queue[0]);
    fetchDef(c);
    // a new word is shown with its meaning; a word met before is recalled first, then opened
    const fresh = !c.st?.last;
    const open = fresh || s.revealed;
    const left = s.queue.length;
    const pct = Math.round((s.reviewed / (s.reviewed + left)) * 100);
    const qs = c.practiced ? [...new Set(c.examples.filter((e) => e.n).map((e) => e.n))] : [];
    const recalled = !fresh && s.revealed ? fmtDays(answerCard(c.st, true).ivl) : "";
    const flipped = justFlipped, enters = entering && !flipped;
    justFlipped = false;
    entering = false;
    return `<div class="vwrap">
      <div class="sess-top">
        <span class="sess-count">Осталось <b>${left}</b></span>
        <div class="bar"><span style="width:${pct}%"></span></div>
        <span class="sess-mix">${left - newInQueue} повтор · ${newInQueue} новых</span>
      </div>
      <article class="card flash ${flipped ? "flip-in" : enters ? "slide-in" : ""} ${open ? "swipeable" : ""}" ${open ? `data-swipe="${fresh ? "learn" : "grade"}"` : `data-action="v-flip" title="Нажмите, чтобы перевернуть"`}>
        <div class="flash-meta">
          <span class="badge">${c.mine && !auto.some((x) => x.key === c.key) && !textDeck.some((x) => x.key === c.key) ? ROLE_LABEL.mine : c.role === "text" || c.role === "choice" ? ROLE_LABEL[c.role] : c.practiced ? ROLE_LABEL[c.role] || "" : c.role === "target" ? ROLE_LABEL.target : ROLE_LABEL.choice}</span>
          ${statusBadge(c)}
          <div class="spacer"></div>
          ${qs.length ? `<span class="mono">вопрос ${qs.join(", ")}</span>` : ""}
        </div>
        <div class="flash-term">${esc(c.term)}</div>
        ${open ? `
          ${defHtml(c)}
          ${cardExamplesHtml(c, s)}
          <label class="field note-field ${c.note || s.noteOpen ? "open" : ""}"><span>Мой перевод / заметка</span>
            <input data-note="${esc(c.key)}" value="${esc(c.note)}" placeholder="например, своими словами" autocomplete="off"></label>
          ${c.note || s.noteOpen ? "" : `<button class="btn btn-ghost btn-sm note-toggle" data-action="v-note">${icon("plus", "icon-sm")} Заметка</button>`}
          ${fresh ? `<p class="flash-hint learn-hint">Новое слово: прочитайте значение и пример. Через несколько карточек его нужно будет вспомнить.</p>
            <button class="btn btn-primary btn-lg" data-action="v-learn">Дальше <kbd>Пробел</kbd></button>` : ""}`
        : `<p class="flash-hint">Вспомните значение, потом переверните карточку</p>
           <button class="btn btn-primary btn-lg" data-action="v-reveal">Показать значение <kbd>Пробел</kbd></button>`}
      </article>
      ${!fresh && s.revealed ? `<div class="grades two ${flipped ? "grades-in" : ""}" role="group" aria-label="Вспомнили значение?">
          <button class="grade g1" data-action="v-grade" data-ok="0"><span>Не вспомнил</span><small>ещё раз сегодня</small><kbd>←</kbd></button>
          <button class="grade g3" data-action="v-grade" data-ok="1"><span>Вспомнил</span><small>${recalled}</small><kbd>→</kbd></button>
        </div>` : ""}
      <div class="flash-foot">
        <span class="row">
          <button class="btn btn-ghost btn-sm" data-action="v-known" title="Убрать из повторений (K)">${icon("check", "icon-sm")} Уже знаю это слово</button>
          ${ctx.ai()?.available() ? `<button class="btn btn-ghost btn-sm ai-only" data-action="ai-ask-word" data-key="${esc(c.key)}">${icon("sparkles", "icon-sm")} Спросить Claude</button>` : ""}
        </span>
        <span class="hints">${fresh
          ? `<span><kbd>Пробел</kbd> дальше</span><span><kbd>K</kbd> знаю</span>`
          : `<span><kbd>Пробел</kbd> показать</span><span><kbd>←</kbd> не вспомнил</span><span><kbd>→</kbd> вспомнил</span><span><kbd>K</kbd> знаю</span>`}</span>
        <span class="swipe-hint">${fresh ? "смахните вправо — дальше" : s.revealed ? "вправо — вспомнил, влево — не вспомнил" : "нажмите на карточку, чтобы перевернуть"}</span>
      </div>
    </div>`;
  }

  const clock = (ms) => { const sec = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`; };

  // Only words just missed are left: a short pause before they come back helps them stick.
  function waitHtml(s) {
    const n = s.queue.length;
    return `<div class="vwrap"><div class="card done-card">
      <div class="done-icon wait">${icon("clock")}</div>
      <h2>${n === 1 ? "Слово вернётся" : "Слова вернутся"} через <span id="v-wait">${clock(s.waitUntil - Date.now())}</span></h2>
      <p>${n === 1 ? "Осталось только слово, которое вы сейчас не вспомнили" : `Остались только слова, которые вы сейчас не вспомнили: ${n}`}. Короткая пауза перед повтором помогает запомнить.</p>
      <div class="row"><button class="btn btn-primary" data-action="v-reveal">Показать сейчас <kbd>Пробел</kbd></button></div>
    </div></div>`;
  }

  function startWait() {
    clearInterval(waitTimer);
    waitTimer = setInterval(() => {
      const el = document.getElementById("v-wait");
      const left = (S.session?.waitUntil || 0) - Date.now();
      if (!el) { clearInterval(waitTimer); return; }
      if (left <= 0) { clearInterval(waitTimer); renderMain(); ctx.refreshChrome(); return; }
      el.textContent = clock(left);
    }, 500);
  }

  function doneHtml(all) {
    const s = S.session;
    const { autoFresh: fresh } = counts(all);
    const tomorrow = startOfDay() + 2 * DAY;
    const dueTomorrow = all.filter((c) => !c.known && c.st?.last && c.st.due < tomorrow).length;
    return `<div class="vwrap"><div class="card done-card">
      <div class="done-icon">${icon("check")}</div>
      <h2>${s.reviewed ? "На сегодня всё" : "Сейчас повторять нечего"}</h2>
      <p>${s.reviewed ? `Повторено ${words(s.reviewed)}, из них новых — ${s.learnedNew}.` : "Все запланированные повторения сделаны."}
        ${dueTomorrow ? `Завтра к повторению: ${words(dueTomorrow)}.` : ""}</p>
      <div class="row">
        ${fresh.length ? `<button class="btn btn-primary" data-action="v-more">${icon("plus", "icon-sm")} Ещё 10 новых слов</button>` : ""}
        <button class="btn btn-outline" data-action="v-tab" data-tab="list">${icon("list", "icon-sm")} Все слова</button>
      </div>
    </div></div>`;
  }

  function filtered(all) {
    const f = S.ui.vfilter || "all";
    const q = (S.ui.vq || "").trim().toLowerCase();
    return all
      .filter((c) => f === "all" || (f === "mine" ? c.mine : c.status === f))
      .filter((c) => !q || c.term.toLowerCase().includes(q) || (c.def || "").toLowerCase().includes(q) || c.note.toLowerCase().includes(q))
      .sort((a, b) => a.term.localeCompare(b.term));
  }

  function rowsHtml(list) {
    if (!list.length) return `<div class="empty small">Ничего не найдено</div>`;
    return list.map((c) => {
      const open = openRow === c.key;
      return `<div class="wrow ${open ? "open" : ""}">
        <button class="wrow-main" data-action="v-row" data-key="${esc(c.key)}" aria-expanded="${open}">
          <span class="sdot s-${c.status}" title="${STATUS_LABEL[c.status]}"></span>
          <span class="wterm">${esc(c.term)}${c.mine ? ` <span class="mine-tag">моё</span>` : ""}</span>
          <span class="wdef">${c.hideDef ? `<span class="muted">откроется после вопроса</span>` : esc(c.def || "—")}${c.note ? ` <span class="wnote">· ${esc(c.note)}</span>` : ""}</span>
          <span class="wwhen">${when(c)}</span>
        </button>
        ${open ? `<div class="wrow-body">
          ${c.sample ? `<p class="flash-sample">${esc(c.sample)}</p>` : ""}
          ${examplesHtml(c, 3)}
          <label class="field"><span>Определение${DEF_SRC[c.defSrc] && c.defSrc !== "user" ? ` (${DEF_SRC[c.defSrc]})` : ""}</span>
            <input data-def="${esc(c.key)}" value="${esc(c.def || "")}" placeholder="своё определение" autocomplete="off"></label>
          <label class="field"><span>Мой перевод / заметка</span>
            <input data-note="${esc(c.key)}" value="${esc(c.note)}" placeholder="например, своими словами" autocomplete="off"></label>
          <div class="row">
            <button class="btn btn-outline btn-sm" data-action="v-toggle-known" data-key="${esc(c.key)}">${c.known ? `${icon("rotate", "icon-sm")} Вернуть в изучение` : `${icon("check", "icon-sm")} Уже знаю`}</button>
            ${c.st?.last ? `<button class="btn btn-ghost btn-sm" data-action="v-reset-card" data-key="${esc(c.key)}">Начать заново</button>` : ""}
            ${ctx.ai()?.available() ? `<button class="btn btn-ghost btn-sm" data-action="ai-ask-word" data-key="${esc(c.key)}">${icon("sparkles", "icon-sm")} Спросить Claude</button>` : ""}
            ${c.mine && !auto.some((a) => a.key === c.key) ? `<button class="btn btn-ghost btn-sm danger-text" data-action="v-delete" data-key="${esc(c.key)}">${icon("trash", "icon-sm")} Удалить</button>` : ""}
          </div>
        </div>` : ""}
      </div>`;
    }).join("");
  }

  function listHtml() {
    const list = filtered(cards());
    return `<div class="vwrap wide">
      <div class="list-head">
        <label class="search">${icon("search", "icon-sm")}<input id="vsearch" value="${esc(S.ui.vq || "")}" placeholder="Поиск по словам, определениям и заметкам" autocomplete="off"></label>
        <button class="btn btn-outline" data-action="v-add-open">${icon("plus", "icon-sm")} Добавить слово</button>
      </div>
      ${addOpen ? `<form class="card addform" id="addform">
        <label class="field"><span>Слово или выражение</span><input name="term" required maxlength="40" autocomplete="off" placeholder="например, ephemeral"></label>
        <label class="field"><span>Определение <small>(можно оставить пустым — найду в словаре)</small></span><input name="def" autocomplete="off"></label>
        <label class="field"><span>Перевод / заметка</span><input name="note" autocomplete="off"></label>
        <div class="row"><button class="btn btn-primary" type="submit">Добавить</button><button class="btn btn-ghost" type="button" data-action="v-add-open">Отмена</button></div>
      </form>` : ""}
      <div class="wcount" id="wcount">${words(list.length)}</div>

      <div class="wlist" id="wlist">${rowsHtml(list)}</div>
    </div>`;
  }

  // ---------------------------------------------------------------- per-question words

  function questionWordsHtml(q) {
    const list = cards().filter((c) => c.qids.includes(q.id))
      .sort((a, b) => (a.role === "answer" || a.role === "target" ? -1 : 0) - (b.role === "answer" || b.role === "target" ? -1 : 0));
    if (!list.length) return "";
    return `<section class="card qwords">
      <div class="qwords-head">${icon("cards")} <span>Слова из этого вопроса</span><span class="hint">уже в словаре</span>
        <button class="btn btn-ghost btn-sm" data-action="view" data-view="vocab">Учить ${icon("right", "icon-sm")}</button></div>
      <div class="qwords-list">${list.map((c) => `
        <div class="qword"><span class="sdot s-${c.status}" title="${STATUS_LABEL[c.status]}"></span>
          <b>${esc(c.term)}</b><span>${esc(c.def || "—")}</span></div>`).join("")}
      </div>
    </section>`;
  }

  // ---------------------------------------------------------------- hard words while reading

  const known = (key) => {
    const c = cardMap().get(key);
    return !!c && (c.known || c.status === "mastered");
  };

  function hardWordsOf(q) {
    if (!wordsReady()) return [];
    const skip = S.progress[q.id] ? new Set() : spoilerWords(q);
    return hardWordsIn(passageText(q), threshold(), skip).filter((h) => !known(h.key));
  }

  // Underlines the hard words in the rendered passage; a tap shows the meaning.
  function decoratePassage(q, root) {
    if (!root || !q) return;
    const hard = hardWordsOf(q);
    if (!hard.length) return;
    const forms = new Map(hard.map((h) => [h.form.toLowerCase(), h.key]));
    const re = new RegExp(`(?<![\\p{L}])(${[...forms.keys()].sort((a, b) => b.length - a.length).map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![\\p{L}])`, "giu");
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement.closest(".text-label, .hw") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const text = node.nodeValue;
      re.lastIndex = 0;
      if (!re.test(text)) continue;
      re.lastIndex = 0;
      const frag = document.createDocumentFragment();
      let last = 0;
      for (const m of text.matchAll(re)) {
        frag.append(text.slice(last, m.index));
        const span = document.createElement("span");
        span.className = "hw";
        span.dataset.action = "v-word";
        span.dataset.w = forms.get(m[0].toLowerCase());
        span.dataset.q = q.id;
        span.tabIndex = 0;
        span.setAttribute("role", "button");
        span.textContent = m[0];
        frag.append(span);
        last = m.index + m[0].length;
      }
      frag.append(text.slice(last));
      node.replaceWith(frag);
    }
  }

  // The meaning of any word: its card, the trainer's dictionary, or a looked-up definition.
  function meaning(key) {
    const c = cardMap().get(key);
    if (c?.hideDef) return null;
    if (c?.def) return { d: c.def, p: c.pos };
    const own = defOf(key);
    if (own) return { d: own.d, p: own.p };
    const e = dict[key];
    return e ? { d: typeof e === "string" ? e : e.d, p: "" } : null;
  }

  // A small card next to a highlighted word.
  const wordPop = document.createElement("div");
  wordPop.className = "wordpop";
  wordPop.hidden = true;
  wordPop.setAttribute("role", "dialog");
  document.body.append(wordPop);
  let wordAt = null;

  function showWord(el) {
    const key = el.dataset.w;
    const q = S.set.questions.find((x) => x.id === el.dataset.q);
    const h = q ? hardWordsIn(passageText(q), 9, new Set()).find((x) => x.key === key) : null;
    wordAt = { key, el, q, sentence: h ? `${h.before}${h.form}${h.after}` : "" };
    const c = cardMap().get(key);
    const m = meaning(key);
    const mine = c?.mine || c?.st?.last;
    wordPop.innerHTML = `
      <div class="wp-head"><b>${esc(key)}</b>${m?.p ? `<span class="pos">${esc(m.p)}</span>` : ""}${c?.status && c.status !== "new" ? statusBadge(c) : ""}
        <button class="icon-btn" data-action="v-word-close" aria-label="Закрыть">${icon("x", "icon-sm")}</button></div>
      <div class="wp-def">${m ? esc(m.d) : dict[key] === "" ? `<span class="muted">Определение не найдено</span>` : `<span class="muted">Ищу определение…</span>`}</div>
      <div class="wp-actions">
        <button class="btn btn-primary btn-sm" data-action="v-word-add" ${mine ? "disabled" : ""}>${icon(mine ? "check" : "plus", "icon-sm")} ${mine ? "Уже учу" : "Учить"}</button>
        <button class="btn btn-ghost btn-sm" data-action="v-know" data-w="${esc(key)}">Знаю</button>
        ${ctx.ai()?.available() ? `<button class="btn btn-ghost btn-sm" data-action="v-word-ai">${icon("sparkles", "icon-sm")} Подробнее</button>` : ""}
      </div>`;
    wordPop.hidden = false;
    const r = el.getBoundingClientRect();
    const w = Math.min(320, document.documentElement.clientWidth - 16);
    wordPop.style.width = `${w}px`;
    wordPop.style.left = `${Math.min(Math.max(8, r.left + r.width / 2 - w / 2), document.documentElement.clientWidth - w - 8)}px`;
    wordPop.style.top = `${r.bottom + window.scrollY + 8}px`;
    if (!m && dict[key] === undefined) fetchDef({ key, term: key, examples: wordAt.sentence ? [{ before: wordAt.sentence, term: "", after: "" }] : [] }, () => { if (wordAt?.key === key && !wordPop.hidden) showWord(el); });
  }
  const hideWord = () => { wordPop.hidden = true; wordAt = null; };
  document.addEventListener("click", (e) => {
    if (!wordPop.hidden && !e.target.closest(".wordpop, .hw")) hideWord();
  });
  addEventListener("scroll", () => { if (!wordPop.hidden && wordAt && !wordAt.el.isConnected) hideWord(); }, { passive: true });

  // ---------------------------------------------------------------- words that open a question

  // The words of a question's answer choices, and those not learned yet. Words without any
  // definition cannot be checked and do not count. `loading` until frequencies and definitions are in.
  function gateOf(q) {
    if (!loaded) return { loading: true, cards: [], missing: [] };
    const byKey = cardMap();
    const cards = (gates.get(q.id) || []).map((k) => byKey.get(k)).filter((c) => c && c.def);
    return { loading: false, cards, missing: cards.filter((c) => !c.ready) };
  }

  // Definitions for choice words the trainer's dictionary does not have (a PDF added later).
  function fetchGateDefs(q, after) {
    if (!loaded) return;
    const byKey = cardMap();
    for (const k of gates.get(q.id) || []) {
      const c = byKey.get(k);
      if (c && !c.def && !failedLookups.has(c.key)) fetchDef(c, after);
    }
  }

  // A check before a question counts as a review of the word's card: right is "помню", wrong is
  // "не помню". After a miss the word comes round again, and the right answer then moves it to
  // tomorrow ("сложно" with its 10-minute step would leave it unlearned and close the question).
  function quizResult(key, ok) {
    S.vocab.srs[key] = schedule(S.vocab.srs[key], ok ? 3 : 1);
    save();
    S.session = null;
    if (ok) ctx.onWordDone?.();
  }

  // ---------------------------------------------------------------- adding words

  function addWord(term, { text = "", qid = null, n = null, def = "", note = "" } = {}) {
    term = term.trim().replace(/\s+/g, " ");
    const key = termKey(term);
    if (!key) return;
    const existing = allCards().find((c) => c.key === key);
    if (existing && (existing.mine || existing.st?.last)) {
      if (existing.known) S.vocab.known = S.vocab.known.filter((k) => k !== key);
      save();
      toast(`«${existing.term}» уже в словаре`);
      return;
    }
    const ex = text ? makeExample(text, term, { qid, n, kind: "passage", own: true }) : null;
    S.vocab.user[key] = { key, term, def: null, examples: ex ? [ex] : [], qids: qid ? [qid] : [], role: "mine", src: "user", added: Date.now() };
    if (def || note) S.vocab.edits[key] = { ...(S.vocab.edits[key] || {}), ...(def ? { def } : {}), ...(note ? { note } : {}) };
    save();
    if (!def) fetchDef({ key, term, def: null });
    if (S.session) S.session.queue.push(key);
    toast(`«${term}» добавлено в словарь`);
    ctx.refreshChrome();
  }

  const pop = document.createElement("div");
  pop.className = "selpop";
  pop.hidden = true;
  pop.addEventListener("mousedown", (e) => e.preventDefault()); // keep the selection alive
  document.body.append(pop);
  let pending = null;
  let selTimer = null;
  const hidePop = () => { pop.hidden = true; pending = null; };

  // blanks are drawn as empty lines on the page; put "______" back for the text we keep
  function textWithBlanks(el) {
    const copy = el.cloneNode(true);
    copy.querySelectorAll(".blank").forEach((b) => b.replaceWith("______"));
    return copy.textContent;
  }

  function onSelection() {
    if (!S.set || S.ui.view !== "questions") return hidePop();
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return hidePop();
    const node = sel.anchorNode;
    const host = (node?.nodeType === 1 ? node : node?.parentElement)?.closest(".passage, .prompt, .rat");
    if (!host) return hidePop();
    const raw = sel.toString().replace(/\s+/g, " ").trim().replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "");
    if (!raw || raw.length > 40 || raw.split(" ").length > 4 || !/^[A-Za-z][A-Za-z'’ -]*$/.test(raw)) return hidePop();
    const q = ctx.current();
    if (!q) return hidePop();
    const exists = cards().some((c) => c.key === termKey(raw));
    pending = { term: raw, text: textWithBlanks(host), qid: q.id, n: q.n };
    pop.innerHTML = (exists
      ? `<span class="selpop-note">${icon("check", "icon-sm")} В словаре</span>`
      : `<button type="button" data-action="v-add-sel">${icon("plus", "icon-sm")} В словарь: <b>${esc(raw)}</b></button>`)
      + (ctx.ai()?.available() ? `<button type="button" data-action="ai-explain-sel">${icon("sparkles", "icon-sm")} Объяснить</button>` : "");
    pop.hidden = false;
    const r = sel.getRangeAt(0).getBoundingClientRect();
    const touch = matchMedia("(pointer: coarse)").matches;
    let top = r.top + window.scrollY - pop.offsetHeight - 10;
    if (touch || top < window.scrollY + 70) top = r.bottom + window.scrollY + 10;
    const left = Math.min(Math.max(8, r.left + r.width / 2 - pop.offsetWidth / 2), document.documentElement.clientWidth - pop.offsetWidth - 8);
    pop.style.top = `${top}px`;
    pop.style.left = `${left}px`;
  }
  document.addEventListener("selectionchange", () => { clearTimeout(selTimer); selTimer = setTimeout(onSelection, 120); });

  // ---------------------------------------------------------------- actions & input

  // The answer moves the card: out of today's queue, or 4 cards back after a miss (a minute later
  // at the earliest).
  function record(key, st, missed) {
    const s = S.session;
    s.noteOpen = false;
    s.queue = s.queue.filter((k) => k !== key);
    const prev = S.vocab.srs[key];
    if (!prev?.last) {
      s.learnedNew++;
      if (!S.vocab.user[key]) daily().newCount++; // own words don't use up the daily allowance
    }
    S.vocab.srs[key] = st;
    if (isMastered(st) && !isMastered(prev)) toast(`«${cards().byKey.get(key)?.term || key}» — выучено: теперь редкие повторы`);
    if (missed) s.queue = requeue(s.queue, key, 4);
    else if (!st.ivl) s.queue = requeue(s.queue, key, Infinity);
    s.reviewed++;
    save();
    ctx.onWordDone?.();
  }
  const refreshAll = () => { renderMain(); renderSidebar(); ctx.refreshChrome(); };

  // A new word, read: it is asked a few cards later. Not knowing a word never learned costs no ease.
  // The meaning shows on the back of the card: the front turns away, the back turns in. Without a card
  // on screen (tests, the waiting screen) or with reduced motion, it just shows.
  // 2026-11-26: waiting for the front to turn away made Space feel stuck; showing the back at once
  // felt abrupt. Now the card is turned at once (keys go on at once) while a picture of the front
  // turns away over it and the back then turns in.
  let justFlipped = false;
  const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

  // A picture of the card on screen, laid over the page while it animates away.
  function ghostOf(card, cls, ms) {
    const r = card.getBoundingClientRect();
    const ghost = card.cloneNode(true);
    ghost.classList.remove("flip-in", "slide-in", "swipeable");
    ghost.classList.add("ghost", cls);
    ghost.removeAttribute("data-action");
    ghost.setAttribute("aria-hidden", "true");
    Object.assign(ghost.style, { position: "fixed", left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, margin: "0", pointerEvents: "none", zIndex: "20" });
    document.body.append(ghost);
    setTimeout(() => ghost.remove(), ms);
  }

  function flipReveal() {
    const s = S.session;
    if (!s?.queue.length || s.revealed) return;
    const card = document.querySelector("article.flash");
    justFlipped = !!card && !still();
    if (justFlipped) ghostOf(card, "flip-out", 170);
    s.revealed = true;
    s.noteOpen = false;
    renderMain();
  }

  // Arrows and buttons on a Mac (2026-11-26): the card slides away — right with green for
  // «Вспомнил», left with red for «Не вспомнил», right for «Дальше» — and the next one comes in. The
  // answer counts at once and the next card is there at once: what slides away is a picture of the
  // old card laid over it (waiting for the slide made Space feel stuck).
  let entering = false;
  function slideOut(dir, act) {
    const card = document.querySelector("article.flash");
    if (card && !still()) {
      ghostOf(card, `slide-${dir}`, 280);
      entering = true;
    }
    act();
  }

  // Swiping a card on a phone or an iPad: right — «Вспомнил» (or «Дальше» on a new word), left —
  // «Не вспомнил». The card follows the finger; scrolling up or down is left to the page.
  let drag = null;
  const resetCard = (card) => { card.style.transform = ""; card.classList.remove("swipe-ok", "swipe-bad"); };
  document.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse") return;
    const card = e.target.closest?.("article.flash.swipeable");
    if (!card || e.target.closest("input, textarea, button, a")) return;
    drag = { card, id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), axis: null };
  });
  document.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.axis) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      drag.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    }
    if (drag.axis !== "x") return;
    const grading = drag.card.dataset.swipe === "grade";
    drag.card.style.transition = "none";
    drag.card.style.transform = `translateX(${dx}px) rotate(${dx / 30}deg)`;
    drag.card.classList.toggle("swipe-ok", dx > 30);
    drag.card.classList.toggle("swipe-bad", grading && dx < -30);
  });
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const { card, x, y, t, axis } = drag;
    drag = null;
    if (axis !== "x") return;
    card.style.transition = "transform .18s ease-out";
    const out = e.type === "pointerup" ? swipeOutcome({ dx: e.clientX - x, dy: e.clientY - y, ms: performance.now() - t, width: card.offsetWidth }) : null;
    const grading = card.dataset.swipe === "grade";
    const act = out === "right" ? () => (grading ? grade(true) : learn()) : out === "left" && grading ? () => grade(false) : null;
    if (!act) { resetCard(card); return; }
    card.style.transform = `translateX(${out === "right" ? 120 : -120}%) rotate(${out === "right" ? 8 : -8}deg)`;
    setTimeout(act, 170);
  };
  document.addEventListener("pointerup", endDrag);
  document.addEventListener("pointercancel", endDrag);

  function learn() {
    const s = S.session;
    const key = s?.queue[0];
    if (!key || S.vocab.srs[key]?.last) return;
    s.undo = null;
    record(key, answerCard(S.vocab.srs[key], false), true);
    refreshAll();
  }

  // A word met before, recalled and opened: «Вспомнил» or «Не вспомнил», a plain fact, not a degree.
  function grade(ok) {
    const s = S.session;
    const key = s?.queue[0];
    if (!key || !s.revealed || !S.vocab.srs[key]?.last) return;
    s.undo = null;
    record(key, answerCard(S.vocab.srs[key], ok), !ok);
    s.revealed = false;
    refreshAll();
  }

  function markKnown(key, on) {
    const set = new Set(S.vocab.known);
    on ? set.add(key) : set.delete(key);
    S.vocab.known = [...set];
    save();
  }

  const sizeTest = createSizeTest({
    S, esc, icon, toast, save,
    render: (all) => { if (S.ui.view !== "vocab") return; renderMain(); if (all) renderSidebar(); },
    // the test's frequency edge becomes the level: words rarer than it are hard for this student
    applyLevel: () => { S.vocab.level = "test"; S.session = null; if (loaded) rebuildWords(); cache = null; ctx.refreshChrome(); },
  });

  const actions = {
    ...sizeTest.actions,
    "v-tab": (el) => {
      S.ui.vtab = el.dataset.tab;
      if (el.dataset.tab === "test") sizeTest.open();
      if (el.dataset.tab === "study" && S.session && !S.session.queue.length) S.session = null;
      ctx.saveUi();
      document.body.classList.remove("sidebar-open");
      renderSidebar();
      renderMain(true);
      ctx.refreshChrome();
    },
    "v-filter": (el) => { S.ui.vfilter = el.dataset.filter; S.ui.vtab = "list"; ctx.saveUi(); renderSidebar(); renderMain(true); document.body.classList.remove("sidebar-open"); },
    "v-perday": (el) => { S.vocab.newPerDay = +el.dataset.n; save(); S.session = null; renderSidebar(); renderMain(); ctx.refreshChrome(); },
    "v-reveal": () => flipReveal(),
    // a tap on a card with its meaning hidden turns it over; selecting a word to add it does not
    "v-flip": () => { if (window.getSelection?.()?.isCollapsed !== false) flipReveal(); },
    "v-ex-full": () => { if (S.session?.queue.length) { S.session.fullEx = S.session.queue[0]; renderMain(); } },
    "v-note": () => { if (!S.session) return; S.session.noteOpen = true; renderMain(); document.querySelector("[data-note]")?.focus(); },
    "v-grade": (el) => slideOut(el.dataset.ok === "1" ? "right" : "left", () => grade(el.dataset.ok === "1")),
    "v-learn": () => slideOut("next", learn),
    "v-known": () => {
      const s = S.session;
      if (!s?.queue.length) return;
      const key = s.queue.shift();
      // a new word marked known uses up one of the day's new words, or a reload would bring another
      // in its place (2026-11-18: 24 new words after «all done»); own words never count
      const counted = !S.vocab.srs[key]?.last && !S.vocab.user[key];
      if (counted) daily().newCount++;
      markKnown(key, true);
      s.revealed = false;
      s.undo = { key, counted };
      ctx.onWordDone?.();
      renderMain(); renderSidebar(); ctx.refreshChrome();
    },
    // K pressed by mistake (2026-11-18): the word comes back first, as it was, until the next card is done
    "v-undo-known": () => {
      const s = S.session;
      const { key, counted } = s?.undo || {};
      if (!key) return;
      s.undo = null;
      if (counted) daily().newCount = Math.max(0, daily().newCount - 1);
      markKnown(key, false);
      s.queue.unshift(key);
      s.revealed = false;
      ctx.onWordUndone?.();
      renderMain(); renderSidebar(); ctx.refreshChrome();
    },
    "v-more": () => { daily().extra = (daily().extra || 0) + 10; save(); S.session = null; renderMain(); renderSidebar(); ctx.refreshChrome(); },
    "v-row": (el) => {
      openRow = openRow === el.dataset.key ? null : el.dataset.key;
      const c = openRow && cards().find((x) => x.key === openRow);
      if (c) fetchDef(c);
      refreshList();
    },
    "v-toggle-known": (el) => { const c = cards().find((x) => x.key === el.dataset.key); markKnown(el.dataset.key, !c?.known); refreshList(); renderSidebar(); ctx.refreshChrome(); },
    "v-reset-card": (el) => { ctx.forgetRecord?.("srs", el.dataset.key); delete S.vocab.srs[el.dataset.key]; save(); S.session = null; refreshList(); renderSidebar(); ctx.refreshChrome(); },
    "v-delete": async (el) => {
      const key = el.dataset.key;
      if (!(await ctx.confirmDialog("Удалить слово?", "Слово и его история повторений будут удалены из словаря.", "Удалить", true))) return;
      ctx.forgetRecord?.("srs", key);
      delete S.vocab.user[key]; delete S.vocab.srs[key]; delete S.vocab.edits[key];
      markKnown(key, false);
      openRow = null;
      refreshList(); renderSidebar(); ctx.refreshChrome();
    },
    "v-add-open": () => { addOpen = !addOpen; renderMain(); if (addOpen) $("#addform input[name=term]")?.focus(); },
    "v-add-sel": () => {
      if (!pending) return;
      const p = pending;
      window.getSelection()?.removeAllRanges();
      hidePop();
      addWord(p.term, { text: p.text, qid: p.qid, n: p.n });
    },
    "v-open-q": (el) => ctx.openQuestion(el.dataset.id),
    "v-word": (el) => showWord(el),
    "v-word-close": hideWord,
    "v-word-add": () => {
      if (!wordAt) return;
      const { key, q, sentence } = wordAt;
      addWord(key, { text: sentence, qid: q?.id, n: q?.n });
      hideWord();
    },
    "v-word-ai": () => {
      if (!wordAt) return;
      const { key, sentence } = wordAt;
      hideWord();
      ctx.ai()?.explainSelection(key, sentence);
    },
    "v-know": (el) => {
      markKnown(el.dataset.w, true);
      hideWord();
      toast(`«${el.dataset.w}» больше не подсвечивается`);
      ctx.refreshQuestion();
    },
    "v-level": (el) => {
      S.vocab.level = el.dataset.level;
      save();
      S.session = null;
      if (loaded) rebuildWords();
      cache = null;
      renderSidebar(); renderMain(); ctx.refreshChrome();
    },
    "ai-explain-sel": () => {
      if (!pending) return;
      const p = pending;
      const sentence = makeExample(p.text, p.term, {});
      window.getSelection()?.removeAllRanges();
      hidePop();
      ctx.ai()?.explainSelection(p.term, sentence ? sentence.before + sentence.term + sentence.after : "");
    },
  };

  function refreshList() {
    const list = filtered(cards());
    const wl = $("#wlist"), wc = $("#wcount");
    if (!wl) return renderMain();
    wl.innerHTML = rowsHtml(list);
    wc.textContent = words(list.length);
    ctx.ai()?.follow();
  }

  let noteTimer = null;
  function onInput(e) {
    const t = e.target;
    if (t.id === "vsearch") { S.ui.vq = t.value; refreshList(); return true; }
    const key = t.dataset.note ?? t.dataset.def;
    if (key === undefined) return false;
    const field = t.dataset.note !== undefined ? "note" : "def";
    S.vocab.edits[key] = { ...(S.vocab.edits[key] || {}), [field]: t.value.trim() };
    clearTimeout(noteTimer);
    noteTimer = setTimeout(save, 300);
    return true;
  }

  function onSubmit(e) {
    if (e.target.id !== "addform") return false;
    e.preventDefault();
    const f = new FormData(e.target);
    const term = String(f.get("term") || "").trim();
    if (!term) return true;
    addWord(term, { def: String(f.get("def") || "").trim(), note: String(f.get("note") || "").trim() });
    addOpen = false;
    renderMain();
    renderSidebar();
    return true;
  }

  function onKey(e) {
    if (S.ui.vtab === "test") return sizeTest.onKey(e);
    const s = S.session;
    if (e.key.toLowerCase() === "z" && s?.undo && (S.ui.vtab || "study") === "study") { actions["v-undo-known"](); return true; }
    if ((S.ui.vtab || "study") !== "study" || !s?.queue.length) return false;
    const k = e.key.toLowerCase();
    const fresh = !S.vocab.srs[s.queue[0]]?.last;
    if (fresh && !s.waitUntil) {
      if (k === " " || k === "enter" || k === "arrowright") { slideOut("next", learn); return true; }
      if (k === "k") { actions["v-known"](); return true; }
      return false;
    }
    if ((k === " " || k === "enter") && !s.revealed) { flipReveal(); return true; }
    if (s.revealed && (k === "arrowleft" || k === "1")) { slideOut("left", () => grade(false)); return true; }
    if (s.revealed && (k === "arrowright" || k === "2")) { slideOut("right", () => grade(true)); return true; }
    if (k === "k" && (s.revealed || !s.waitUntil)) { actions["v-known"](); return true; }
    return false;
  }

  // ---------------------------------------------------------------- backup

  function merge(incoming) {
    if (!incoming || typeof incoming !== "object") return 0;
    let n = 0;
    // a device that has studied nothing takes the settings too; a used one keeps its own
    if (!Object.keys(S.vocab.srs).length) {
      if (incoming.level) S.vocab.level = incoming.level;
      if (incoming.newPerDay) S.vocab.newPerDay = incoming.newPerDay;
    }
    for (const [k, st] of Object.entries(incoming.srs || {})) {
      const mine = S.vocab.srs[k];
      if (!mine || (st.last || 0) > (mine.last || 0)) { S.vocab.srs[k] = st; n++; }
    }
    for (const [k, u] of Object.entries(incoming.user || {})) if (!S.vocab.user[k]) { S.vocab.user[k] = u; n++; }
    for (const [k, e] of Object.entries(incoming.edits || {})) S.vocab.edits[k] = { ...e, ...(S.vocab.edits[k] || {}) };
    S.vocab.known = [...new Set([...S.vocab.known, ...(incoming.known || [])])];
    if (incoming.test && (!S.vocab.test || incoming.test.at > S.vocab.test.at)) S.vocab.test = incoming.test;
    save();
    accountChanged();
    return n;
  }

  // The cards came from outside (the account, a file): today's queue and, with a new level, the word lists follow.
  function accountChanged() {
    cache = null;
    S.session = null;
    if (loaded) adoptDerived();
    if (loaded && threshold() !== builtFor) rebuildWords();
  }

  const currentKey = () => ((S.ui.vtab || "study") === "study" && S.session?.queue.length ? S.session.queue[0] : openRow);

  return {
    rebuild, renderSidebar, renderMain, questionWordsHtml, dueTotal, actions, onInput, onSubmit, onKey, merge, decoratePassage, hideWord,
    hidePop, accountChanged,
    gateOf, fetchGateDefs, quizResult, invalidate: () => { cache = null; },
    card: (key) => cards().find((c) => c.key === key) || null,
    studied: () => cards().filter((c) => c.known || c.st?.last).length,
    currentKey,
  };
}
