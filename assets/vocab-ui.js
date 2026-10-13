// Vocabulary screens: flashcards with spaced repetition, word list, and "add word from text".
import { buildDeck, schedule, previewIntervals, statusOf, termKey, lookup, makeExample, startOfDay, fmtDays } from "./vocab.js";
import { LEVELS, levelZipf, loadFrequencies, loadDefs, defOf, defsPool, wordsReady, hardWordsIn, spoilerWords, passageText, buildTextDeck, choiceWords } from "./words.js";

const DAY = 86400000;
const STATUS_LABEL = { new: "новое", learning: "изучаю", mastered: "выучено", known: "знаю" };
const ROLE_LABEL = { answer: "правильный ответ", target: "слово из текста", distractor: "неверный вариант", mine: "моё слово", text: "слово из текста", choice: "слово из вариантов ответа" };
const DEF_SRC = { sat: "", dict: "из Wiktionary", ai: "объяснение Claude", user: "моё определение" };

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
      ctx.refreshChrome();
      if (S.ui.view === "vocab") { renderSidebar(); renderMain(); }
      else if (S.ui.view === "questions") ctx.refreshTrainer();
    });
  }

  // Words that depend on the learner's level: hard words of the texts and of the choices.
  function rebuildWords() {
    const level = levelZipf(S.vocab.level);
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
      else if (d) { c.def = typeof d === "string" ? d : d.d; c.defSrc = typeof d === "string" ? "dict" : d.s || "dict"; }
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

  // Own words first, then words from questions answered wrong, then the words of the answer choices
  // of the questions ahead (they open those questions), then the other words of those questions.
  // Within a question the choices come in a fixed shuffled order, so the answer is never first.
  const mix = (k) => { let h = 2166136261; for (const ch of k) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };
  function gateNumbers() {
    const first = new Map();
    for (const q of S.set.questions) {
      if (S.progress[q.id]) continue;
      for (const k of gates.get(q.id) || []) if (!first.has(k)) first.set(k, q.n);
    }
    return first;
  }
  function priority(c, gateN) {
    if (c.mine) return 0;
    if (c.qids.some((id) => S.progress[id] && !S.progress[id].ok)) return 1;
    if (gateN.has(c.key)) return 2;
    if (c.qids.some((id) => !S.progress[id])) return 3;
    return 4;
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
    const gateN = gateNumbers();
    const n = (c) => gateN.get(c.key) ?? c.n;
    autoFresh.sort((a, b) => priority(a, gateN) - priority(b, gateN) || n(a) - n(b) || (b.zipf || 0) - (a.zipf || 0) || mix(a.key) - mix(b.key));
    S.session = {
      queue: [...due.map((c) => c.key), ...mineFresh.map((c) => c.key), ...autoFresh.slice(0, newLeft).map((c) => c.key)],
      revealed: false, reviewed: 0, learnedNew: 0, day: today(),
    };
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

  function examplesHtml(c, limit = 2) {
    const later = c.hiddenExamples ? `<p class="ex-later">${icon("lock", "icon-sm")} Пример из вопроса появится, когда вы его решите — чтобы слово не подсказывало ответ.</p>` : "";
    if (!c.examples.length) return later;
    return `${later}<div class="examples">${c.examples.slice(0, limit).map((e) => `
      <figure class="ex">
        <blockquote>${esc(e.before)}<mark>${esc(e.term || c.term)}</mark>${esc(e.after)}</blockquote>
        <figcaption>${e.kind === "rationale" ? "из разбора" : "из текста"}${e.n ? ` · <button class="linkish" data-action="v-open-q" data-id="${esc(e.qid)}">вопрос ${e.n} →</button>` : ""}</figcaption>
      </figure>`).join("")}</div>`;
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
    $("#sidebar").innerHTML = `
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
        <div class="chips">${LEVELS.map((l) => `
          <button class="chip ${(S.vocab.level || "middle") === l.id ? "active" : ""}" data-action="v-level" data-level="${l.id}">${l.label}</button>`).join("")}
        </div>
        <p class="side-hint">От уровня зависит, какие слова в текстах и вариантах ответа считаются трудными — и какие нужно выучить перед вопросом.</p>
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
    main.innerHTML = seg + (tab === "list" ? listHtml() : studyHtml());
    if (scrollTop) window.scrollTo({ top: 0 });
    ctx.ai()?.follow();
  }

  function studyHtml() {
    const all = cards();
    if (!all.length) {
      return `<div class="vwrap"><div class="empty"><h3>Словарь пуст</h3>
        <p>В этом наборе нет вопросов Words in Context. Добавляйте слова сами: выделите слово в тексте вопроса.</p></div></div>`;
    }
    const { s, byKey, fresh: newInQueue } = todayCards();
    if (!s.queue.length) return doneHtml(all);
    const c = byKey.get(s.queue[0]);
    if (s.revealed) fetchDef(c);
    const left = s.queue.length;
    const pct = Math.round((s.reviewed / (s.reviewed + left)) * 100);
    const iv = previewIntervals(c.st);
    const qs = c.practiced ? [...new Set(c.examples.filter((e) => e.n).map((e) => e.n))] : [];
    return `<div class="vwrap">
      <div class="sess-top">
        <span class="sess-count">Осталось <b>${left}</b></span>
        <div class="bar"><span style="width:${pct}%"></span></div>
        <span class="sess-mix">${left - newInQueue} повтор · ${newInQueue} новых</span>
      </div>
      <article class="card flash">
        <div class="flash-meta">
          <span class="badge">${c.mine && !auto.some((a) => a.key === c.key) && !textDeck.some((a) => a.key === c.key) ? ROLE_LABEL.mine : c.role === "text" || c.role === "choice" ? ROLE_LABEL[c.role] : c.practiced ? ROLE_LABEL[c.role] || "" : c.role === "target" ? ROLE_LABEL.target : ROLE_LABEL.choice}</span>
          ${statusBadge(c)}
          <div class="spacer"></div>
          ${qs.length ? `<span class="mono">вопрос ${qs.join(", ")}</span>` : ""}
        </div>
        <div class="flash-term">${esc(c.term)}</div>
        ${s.revealed ? `
          ${defHtml(c)}
          ${examplesHtml(c)}
          <label class="field"><span>Мой перевод / заметка</span>
            <input data-note="${esc(c.key)}" value="${esc(c.note)}" placeholder="например, своими словами" autocomplete="off"></label>`
        : `<p class="flash-hint">Вспомните значение, потом откройте карточку</p>
           <button class="btn btn-primary btn-lg" data-action="v-reveal">Показать значение <kbd>Пробел</kbd></button>`}
      </article>
      ${s.revealed ? `<div class="grades" role="group" aria-label="Насколько хорошо вы помните">
        ${[["Не помню", "g1"], ["Сложно", "g2"], ["Помню", "g3"], ["Легко", "g4"]].map(([label, cls], i) => `
          <button class="grade ${cls}" data-action="v-grade" data-g="${i + 1}"><span>${label}</span><small>${iv[i]}</small><kbd>${i + 1}</kbd></button>`).join("")}
      </div>` : ""}
      <div class="flash-foot">
        <span class="row">
          <button class="btn btn-ghost btn-sm" data-action="v-known" title="Убрать из повторений (K)">${icon("check", "icon-sm")} Уже знаю это слово</button>
          ${ctx.ai()?.available() ? `<button class="btn btn-ghost btn-sm ai-only" data-action="ai-ask-word" data-key="${esc(c.key)}">${icon("sparkles", "icon-sm")} Спросить Claude</button>` : ""}
        </span>
        <span class="hints"><span><kbd>Пробел</kbd> показать</span><span><kbd>1</kbd>–<kbd>4</kbd> оценка</span><span><kbd>K</kbd> знаю</span></span>
      </div>
    </div>`;
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
    return hardWordsIn(passageText(q), levelZipf(S.vocab.level), skip).filter((h) => !known(h.key));
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

  // A check before a question counts as a review of the word's card: right on the first try is
  // "remember", right after a slip is "hard", wrong is "again".
  function quizResult(key, ok, slipped) {
    S.vocab.srs[key] = schedule(S.vocab.srs[key], ok ? (slipped ? 2 : 3) : 1);
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

  function grade(g) {
    const s = S.session;
    if (!s || !s.revealed || !s.queue.length) return;
    const key = s.queue.shift();
    const prev = S.vocab.srs[key];
    if (!prev?.last) {
      s.learnedNew++;
      if (!S.vocab.user[key]) daily().newCount++; // own words don't use up the daily allowance
    }
    S.vocab.srs[key] = schedule(prev, g);
    if (g === 1) s.queue.push(key); // see it again this session
    s.reviewed++;
    s.revealed = false;
    save();
    ctx.onWordDone?.();
    renderMain();
    renderSidebar();
    ctx.refreshChrome();
  }

  function markKnown(key, on) {
    const set = new Set(S.vocab.known);
    on ? set.add(key) : set.delete(key);
    S.vocab.known = [...set];
    save();
  }

  const actions = {
    "v-tab": (el) => {
      S.ui.vtab = el.dataset.tab;
      if (el.dataset.tab === "study" && S.session && !S.session.queue.length) S.session = null;
      ctx.saveUi();
      document.body.classList.remove("sidebar-open");
      renderSidebar();
      renderMain(true);
      ctx.refreshChrome();
    },
    "v-filter": (el) => { S.ui.vfilter = el.dataset.filter; S.ui.vtab = "list"; ctx.saveUi(); renderSidebar(); renderMain(true); document.body.classList.remove("sidebar-open"); },
    "v-perday": (el) => { S.vocab.newPerDay = +el.dataset.n; save(); S.session = null; renderSidebar(); renderMain(); ctx.refreshChrome(); },
    "v-reveal": () => { if (S.session?.queue.length) { S.session.revealed = true; renderMain(); } },
    "v-grade": (el) => grade(+el.dataset.g),
    "v-known": () => {
      const s = S.session;
      if (!s?.queue.length) return;
      const key = s.queue.shift();
      markKnown(key, true);
      s.revealed = false;
      ctx.onWordDone?.();
      renderMain(); renderSidebar(); ctx.refreshChrome();
      toast("Слово убрано из повторений");
    },
    "v-more": () => { daily().extra = (daily().extra || 0) + 10; save(); S.session = null; renderMain(); renderSidebar(); ctx.refreshChrome(); },
    "v-row": (el) => {
      openRow = openRow === el.dataset.key ? null : el.dataset.key;
      const c = openRow && cards().find((x) => x.key === openRow);
      if (c) fetchDef(c);
      refreshList();
    },
    "v-toggle-known": (el) => { const c = cards().find((x) => x.key === el.dataset.key); markKnown(el.dataset.key, !c?.known); refreshList(); renderSidebar(); ctx.refreshChrome(); },
    "v-reset-card": (el) => { delete S.vocab.srs[el.dataset.key]; save(); S.session = null; refreshList(); renderSidebar(); ctx.refreshChrome(); },
    "v-delete": async (el) => {
      const key = el.dataset.key;
      if (!(await ctx.confirmDialog("Удалить слово?", "Слово и его история повторений будут удалены из словаря.", "Удалить", true))) return;
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
    if ((S.ui.vtab || "study") !== "study" || !S.session?.queue.length) return false;
    const k = e.key.toLowerCase();
    if ((k === " " || k === "enter") && !S.session.revealed) { actions["v-reveal"](); return true; }
    if (S.session.revealed && "1234".includes(k) && k.length === 1) { grade(+k); return true; }
    if (k === "k") { actions["v-known"](); return true; }
    return false;
  }

  // ---------------------------------------------------------------- backup

  function merge(incoming) {
    if (!incoming || typeof incoming !== "object") return 0;
    let n = 0;
    for (const [k, st] of Object.entries(incoming.srs || {})) {
      const mine = S.vocab.srs[k];
      if (!mine || (st.last || 0) > (mine.last || 0)) { S.vocab.srs[k] = st; n++; }
    }
    for (const [k, u] of Object.entries(incoming.user || {})) if (!S.vocab.user[k]) { S.vocab.user[k] = u; n++; }
    for (const [k, e] of Object.entries(incoming.edits || {})) S.vocab.edits[k] = { ...e, ...(S.vocab.edits[k] || {}) };
    S.vocab.known = [...new Set([...S.vocab.known, ...(incoming.known || [])])];
    save();
    S.session = null;
    return n;
  }

  const currentKey = () => ((S.ui.vtab || "study") === "study" && S.session?.queue.length ? S.session.queue[0] : openRow);

  return {
    rebuild, renderSidebar, renderMain, questionWordsHtml, dueTotal, actions, onInput, onSubmit, onKey, merge, decoratePassage, hideWord,
    hidePop, resetSession: () => { S.session = null; },
    gateOf, fetchGateDefs, quizResult, invalidate: () => { cache = null; },
    card: (key) => cards().find((c) => c.key === key) || null,
    studied: () => cards().filter((c) => c.known || c.st?.last).length,
    currentKey,
  };
}
