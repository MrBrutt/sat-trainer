// Words before a question: a question opens once the student knows the words of its answer choices.
// Unknown words are shown with their meanings, then checked one by one (word → pick its meaning).
// Answering without knowing what the choices mean is guessing, not practice.
import { defsPool } from "./words.js";

const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
const posOf = (p) => (p || "").split(/[./]/)[0];

export function createPrep(ctx) {
  const { S, esc, icon, plural, toast, vocab } = ctx;
  const skipped = new Set();     // questions opened without the check, for this visit
  let quiz = null;               // {qid, gate, pool, items: [{key, term, def, options, picked}], i, slipped: Set, right}
  let advance = null;

  const words = (n) => `${n} ${plural(n, "слово", "слова", "слов")}`;

  // Closed: not answered yet, not opened anyway, and some choice word is not learned (or the
  // dictionary is still loading, so we do not know yet).
  function locked(q) {
    if (!q || ctx.answerOf(q) || skipped.has(q.id)) return false;
    if (quiz?.qid === q.id) return true;          // the check runs to its end before the question opens
    const g = vocab.gateOf(q);
    return g.loading || g.missing.length > 0;
  }
  const missingCount = (q) => vocab.gateOf(q).missing.length;

  // Three wrong meanings: one of another choice of the same question (telling them apart is the
  // point), the rest from words of the same part of speech.
  function options(card, siblings, pool) {
    const wrong = [];
    const used = new Set([card.def]);
    const take = (d) => { if (d && !used.has(d) && wrong.length < 3) { used.add(d); wrong.push(d); } };
    for (const c of shuffle(siblings).slice(0, 1)) take(c.def);
    const from = Math.floor(Math.random() * pool.length);     // a different stretch of the pool for every word
    const around = pool.slice(from).concat(pool.slice(0, from));
    for (const x of around) if (posOf(x.p) === posOf(card.pos)) take(x.d);
    for (const x of around) take(x.d);
    return shuffle([card.def, ...wrong]);
  }

  function item(card, gate, pool) {
    const siblings = gate.cards.filter((c) => c.key !== card.key && posOf(c.pos) === posOf(card.pos));
    return { key: card.key, term: card.term, def: card.def, pos: card.pos, sample: card.sample, options: options(card, siblings, pool), picked: null };
  }

  function start(q) {
    const gate = vocab.gateOf(q);
    if (!gate.missing.length) return;
    // meanings that name their part of speech ("adj. main; n. the head of a school") would stand out
    const pool = shuffle(defsPool().filter((x) => !/^(?:adj|n|v|adv)\.\s/.test(x.d)));
    quiz = { qid: q.id, gate, pool, items: shuffle(gate.missing).map((c) => item(c, gate, pool)), i: 0, slipped: new Set(), right: 0 };
  }

  // ---------------------------------------------------------------- screens

  function html(q) {
    const gate = vocab.gateOf(q);
    if (gate.loading) return `<section class="card prep"><div class="prep-loading">${icon("cards")} Загружаю словарь…</div></section>`;
    vocab.fetchGateDefs(q, () => ctx.refresh());
    if (quiz?.qid === q.id) return quizHtml(q);
    // new words are shown with their meanings; words due for review are recalled first, as in the cards
    const fresh = gate.missing.filter((c) => !c.review);
    const due = gate.missing.filter((c) => c.review);
    const knownN = gate.cards.length - gate.missing.length;
    const wic = /words in context/i.test(q.skill);
    const todo = fresh.length && due.length
      ? `Выучите ${fresh.length === 1 ? "новое слово" : `${fresh.length} ${plural(fresh.length, "новое слово", "новых слова", "новых слов")}`} и вспомните ${due.length === 1 ? "одно, которое уже учили" : `${due.length}, которые уже учили`}, — потом короткая проверка, и вопрос откроется.`
      : fresh.length
        ? `Выучите ${fresh.length === 1 ? "это слово" : `эти ${words(fresh.length)}`} и пройдите короткую проверку — вопрос откроется.`
        : `${due.length === 1 ? "Это слово вы уже учили, но пришло время его повторить" : `Эти ${words(due.length)} вы уже учили, но пришло время их повторить`}: вспомните значения в проверке — вопрос откроется.`;
    return `<section class="card prep">
      <div class="prep-head">
        <div class="prep-icon">${icon("lock")}</div>
        <div>
          <h2>${fresh.length ? "Сначала слова из вариантов ответа" : "Сначала вспомните слова из вариантов"}</h2>
          <p>${wic ? "В этом вопросе нужно выбрать слово по смыслу." : "Варианты ответа — это предложения, и в них есть трудные слова."}
            Не зная, что они значат, вы будете угадывать. ${todo}
            ${knownN ? `<span class="muted">Ещё ${words(knownN)} из вариантов вы помните.</span>` : ""}</p>
        </div>
      </div>
      <ol class="prep-list">${fresh.map((c) => `
        <li class="prep-word">
          <div class="pw-top"><b>${esc(c.term)}</b>${c.pos ? `<span class="pos">${esc(c.pos)}</span>` : ""}${c.st?.last ? `<span class="spill s-learning" title="В прошлый раз вы не вспомнили это слово">ещё раз</span>` : ""}</div>
          <div class="pw-def">${esc(c.def)}</div>
          ${c.sample ? `<div class="pw-ex">${esc(c.sample)}</div>` : ""}
        </li>`).join("")}${due.map((c) => `
        <li class="prep-word">
          <div class="pw-top"><b>${esc(c.term)}</b>${c.pos ? `<span class="pos">${esc(c.pos)}</span>` : ""}<span class="spill s-learning" title="Пора повторить: значение откроется в проверке">повторить</span></div>
          <div class="pw-def muted">Вспомните значение — оно откроется в проверке</div>
        </li>`).join("")}
      </ol>
      <div class="prep-actions">
        <button class="btn btn-primary btn-lg" data-action="prep-start">${icon("check", "icon-sm")} Проверить себя · ${words(gate.missing.length)} <kbd>Enter</kbd></button>
        <button class="btn btn-ghost btn-sm" data-action="prep-skip" title="Вопрос откроется без проверки слов">Решать без подготовки</button>
      </div>
    </section>`;
  }

  function quizHtml(q) {
    const it = quiz.items[quiz.i];
    const total = quiz.items.length;
    const doneN = quiz.right;
    const answered = it.picked !== null;
    return `<section class="card prep quiz">
      <div class="sess-top">
        <span class="sess-count">Проверка слов · вопрос ${q.n}</span>
        <div class="bar"><span style="width:${Math.round((doneN / quiz.gate.missing.length) * 100)}%"></span></div>
        <span class="sess-mix">${doneN} из ${quiz.gate.missing.length}</span>
      </div>
      <div class="quiz-term">${esc(it.term)}${it.pos ? ` <span class="pos">${esc(it.pos)}</span>` : ""}</div>
      <p class="quiz-ask">Что значит это слово?</p>
      <div class="quiz-options" role="group" aria-label="Значения">${it.options.map((d, i) => {
        let cls = "";
        if (answered) cls = d === it.def ? "correct" : d === it.picked ? "wrong" : "dim";
        return `<button class="quiz-opt ${cls}" data-action="prep-pick" data-i="${i}" ${answered ? "disabled" : ""}><kbd>${i + 1}</kbd><span>${esc(d)}</span></button>`;
      }).join("")}</div>
      ${answered && it.picked !== it.def ? `<div class="quiz-miss">
          ${it.sample ? `<p class="pw-ex">${esc(it.sample)}</p>` : ""}
          <p class="muted">Слово вернётся в конце проверки.</p>
          <button class="btn btn-primary" data-action="prep-next">Дальше <kbd>Enter</kbd></button>
        </div>` : ""}
      <div class="prep-actions small">
        <button class="btn btn-ghost btn-sm" data-action="prep-back">${icon("left", "icon-sm")} К списку слов</button>
        <span class="muted">${total - quiz.i - 1 > 0 ? `осталось ${words(total - quiz.i - 1)}` : "последнее слово"}</span>
      </div>
    </section>`;
  }

  // ---------------------------------------------------------------- actions

  function pick(i) {
    if (!quiz) return;
    const it = quiz.items[quiz.i];
    if (!it || it.picked !== null) return;
    it.picked = it.options[i];
    const ok = it.picked === it.def;
    vocab.quizResult(it.key, ok);
    if (ok) {
      quiz.right++;
      ctx.refresh();
      clearTimeout(advance);
      advance = setTimeout(next, 650);
    } else {
      quiz.slipped.add(it.key);
      // the word comes back at the end with the options in a new order
      const card = quiz.gate.missing.find((c) => c.key === it.key);
      quiz.items.push(item(card, quiz.gate, quiz.pool));
      ctx.refresh();
    }
  }

  function next() {
    clearTimeout(advance);
    if (!quiz) return;
    const it = quiz.items[quiz.i];
    if (!it || it.picked === null) return;
    quiz.i++;
    if (quiz.i < quiz.items.length) { ctx.refresh(); return; }
    const n = quiz.gate.missing.length;
    const clean = n - quiz.slipped.size;
    quiz = null;
    toast(clean === n ? "Все слова с первого раза — теперь вопрос" : `Слова проверены (с первого раза ${clean} из ${n}) — теперь вопрос`);
    ctx.refresh(true);
  }

  const actions = {
    "prep-start": () => { const q = ctx.current(); if (q) { start(q); ctx.refresh(true); } },
    "prep-pick": (el) => pick(+el.dataset.i),
    "prep-next": next,
    "prep-back": () => { quiz = null; ctx.refresh(true); },
    "prep-skip": () => { const q = ctx.current(); if (q) { skipped.add(q.id); quiz = null; ctx.refresh(); } },
  };

  // Keys on the words screen: Enter starts the check, 1–4 pick a meaning, Enter goes on.
  function onKey(e) {
    const k = e.key;
    if (!quiz) {
      if (k === "Enter") { actions["prep-start"](); return true; }
      return false;
    }
    const it = quiz.items[quiz.i];
    if ("1234".includes(k) && k.length === 1 && it && it.picked === null) { pick(+k - 1); return true; }
    if (k === "Enter" && it && it.picked !== null) { next(); return true; }
    if (k === "Escape") { actions["prep-back"](); return true; }
    return false;
  }

  // Leaving a question drops a check in progress.
  const leave = () => { clearTimeout(advance); quiz = null; };

  return { locked, missingCount, html, actions, onKey, leave };
}
