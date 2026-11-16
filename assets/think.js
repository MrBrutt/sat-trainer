// "Think first": in Transitions the choices appear after the student has named the relation between
// the sentences, checked against the right answer. Words in Context, Command of Evidence and Inferences
// asked for the student's own words until 2026-11-16; the student found it a waste of time ("it could be
// anything") and typed "kk" to get past it, so those open with the choices. Answers from those days keep
// what was written (`own`), and the feedback still shows it.
import { plain } from "./parser.js";

const kindOf = (q) => (/^transitions$/i.test(q.skill || "") ? "transition" : null);

// The five relations a transition can carry, with the words that carry them.
const RELATIONS = {
  contrast: { label: "Противопоставление или уступка", hint: "«но», «однако», «зато»", words: ["however", "nevertheless", "nonetheless", "still", "though", "yet", "by contrast", "in contrast", "on the other hand", "conversely", "on the contrary", "instead", "rather", "that said", "that being said", "granted", "admittedly", "regardless", "even so"] },
  more: { label: "Продолжение или сходство", hint: "«и ещё», «так же», «более того»", words: ["additionally", "moreover", "furthermore", "in addition", "besides", "also", "indeed", "similarly", "likewise"] },
  cause: { label: "Причина и следствие", hint: "«поэтому», «в результате»", words: ["thus", "hence", "therefore", "consequently", "as a result", "accordingly", "for this reason", "as such", "to that end", "in so doing"] },
  example: { label: "Пример или уточнение", hint: "«например», «а именно»", words: ["for example", "for instance", "specifically", "in particular", "in other words", "that is", "to illustrate"] },
  time: { label: "Порядок во времени или итог", hint: "«потом», «раньше», «в итоге»", words: ["previously", "earlier", "finally", "lastly", "subsequently", "afterward", "next", "then", "later", "meanwhile", "ultimately", "eventually", "in the end", "in conclusion", "in sum", "in summary", "to conclude"] },
};
const RELATION_OF = new Map(Object.entries(RELATIONS).flatMap(([rel, r]) => r.words.map((w) => [w, rel])));
const relLabel = (rel) => RELATIONS[rel]?.label.toLowerCase() || "";

// The relation the right answer of a Transitions question carries, or null when the list does not know it.
export function relationOf(q) {
  if (kindOf(q) !== "transition" || !q.correct) return null;
  const choice = q.choices.find((c) => c.letter === q.correct);
  const text = choice ? plain(choice).trim().toLowerCase().replace(/[\s.,;:—–-]+$/, "") : "";
  return RELATION_OF.get(text) || null;
}

// Answers with the step and from before it, to see whether the step helps.
export function stepStats(questions, progress) {
  const out = { steps: { n: 0, ok: 0 }, before: { n: 0, ok: 0 } };
  for (const q of questions) {
    const p = progress[q.id];
    if (!p || !kindOf(q)) continue;
    const row = p.rel ? out.steps : out.before;
    row.n++;
    if (p.ok) row.ok++;
  }
  return out;
}

export function createThink({ esc, icon, answerOf, refresh }) {
  const states = new Map();
  let current = null;

  function state(q) {
    current = q;
    if (!states.has(q.id)) states.set(q.id, { step: "rel", rel: null, relation: relationOf(q) });
    return states.get(q.id);
  }

  const locked = (q) => !!q && !!kindOf(q) && !answerOf(q) && state(q).step !== "open";

  function html() {
    return `<section class="card think">
      <div class="think-head">${icon("target", "icon-sm")}<b>Сначала сами</b></div>
      <p>Как предложение с пропуском связано с предыдущим? Выберите связь, потом откроются варианты.</p>
      <div class="think-rels">${Object.entries(RELATIONS).map(([rel, r]) => `
        <button class="think-rel" data-action="think-rel" data-rel="${rel}"><b>${r.label}</b><span>${r.hint}</span></button>`).join("")}
      </div>
    </section>`;
  }

  function pickRelation(el) {
    const s = current && state(current);
    if (!s || s.step !== "rel") return;
    s.rel = el.dataset.rel;
    s.step = "open";
    refresh();
  }

  // Over the choices once they open: whether the relation the student named is the one here.
  function note(q) {
    const s = states.get(q.id);
    if (!s?.rel) return "";
    if (!s.relation) return `<p class="think-note think-verdict">Ваш выбор: ${relLabel(s.rel)}.</p>`;
    return s.rel === s.relation
      ? `<p class="think-note think-verdict ok">${RELATIONS[s.rel].label} — да.</p>`
      : `<p class="think-note think-verdict bad">Нет, здесь связь — ${relLabel(s.relation)}. Вы выбрали: ${relLabel(s.rel)}.</p>`;
  }

  // In the feedback after the answer: what the student did before seeing the choices.
  function feedback(q, pr) {
    if (pr.rel) {
      const rel = relationOf(q);
      const text = pr.relOk === true ? `Связь вы определили верно: ${relLabel(pr.rel)}`
        : pr.relOk === false ? `Вы выбрали связь «${relLabel(pr.rel)}», а здесь — ${relLabel(rel)}`
        : `Вы выбрали связь: ${relLabel(pr.rel)}`;
      return `<span class="fnote">${text}</span>`;
    }
    if (!pr.own) return "";
    return `<span class="fnote">${/words in context/i.test(q.skill || "") ? "Ваше слово было" : "Ваша мысль была"}: «${esc(pr.own)}»</span>`;
  }

  // What the student did, for the record of the answer; the next attempt starts over.
  function take(q) {
    const s = states.get(q.id);
    states.delete(q.id);
    return s?.rel ? { rel: s.rel, ...(s.relation ? { relOk: s.rel === s.relation } : {}) } : {};
  }

  return {
    locked, html, take, note, feedback,
    reset: (id) => states.delete(id),
    actions: { "think-rel": pickRelation },
  };
}
