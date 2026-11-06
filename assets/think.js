// Words in Context: the choices appear after the student has thought for themselves, the strategy
// "use your clues, then pick a word of your own" made into steps. First the word that steers the
// sentence with the blank, when there is one; then their own word for the blank. The trainer checks
// the first against a list of signal words; the second it only asks for.
import { plain } from "./parser.js";
import { sentences } from "./vocab.js";

const KINDS = {
  contrast: "Контраст: мысль в пропуске идёт против соседней части предложения.",
  cause: "Причина и следствие: одна часть предложения объясняет другую.",
  same: "Та же линия: мысль продолжается или усиливается.",
};

// "same" comes first so that "but also" is not read as "but"; within a kind, longer phrases first.
const SIGNALS = [
  ["same", ["but also", "not only", "in other words", "for example", "for instance", "in fact", "furthermore", "moreover", "similarly", "likewise", "indeed"]],
  ["contrast", ["on the contrary", "in spite of", "contrary to", "even though", "rather than", "in contrast", "by contrast", "nevertheless", "nonetheless", "notwithstanding", "although", "however", "whereas", "despite", "instead", "though", "unlike", "while", "but", "yet"]],
  ["cause", ["as a result", "consequently", "given that", "therefore", "because", "owing to", "due to", "hence", "thus"]],
];
const SMALL = new Set(["in", "to", "a", "as", "of", "by", "on", "the", "that"]);     // not the clue on their own
const WORD = /\p{L}+(?:['’-]\p{L}+)*/gu;

const isWic = (q) => /words in context/i.test(q.skill);

// The word asked about in "what does the word X most nearly mean".
export const coveredWord = (q) => plain(q.prompt).match(/the word ["“]([^"”]+)["”]/i)?.[1] || null;

// Signal words of the sentence with the blank: [{text, kind}], in order of appearance.
export function clueWords(q) {
  if (coveredWord(q)) return [];
  const sentence = sentences(q.stem.map(plain).join(" ")).find((s) => /_{3,}/.test(s));
  if (!sentence) return [];
  const found = new Map();
  let rest = sentence;
  for (const [kind, list] of SIGNALS) {
    const re = new RegExp(`\\b(?:${list.join("|").replace(/ /g, "\\s+")})\\b`, "gi");
    rest = rest.replace(re, (m, at) => {
      if (/^yet$/i.test(m) && /^\s+to\b/i.test(rest.slice(at + 3))) return m;      // "have yet to find"
      const text = m.toLowerCase().replace(/\s+/g, " ");
      if (!found.has(text)) found.set(text, { text, kind, at });
      return " ".repeat(m.length);
    });
  }
  return [...found.values()].sort((a, b) => a.at - b.at).map(({ text, kind }) => ({ text, kind }));
}

// Words in Context answers with the steps and from before them, to see whether the steps help.
export function stepStats(questions, progress) {
  const out = { steps: { n: 0, ok: 0 }, before: { n: 0, ok: 0 } };
  for (const q of questions) {
    const p = progress[q.id];
    if (!p || !isWic(q)) continue;
    const row = p.own ? out.steps : out.before;
    row.n++;
    if (p.ok) row.ok++;
  }
  return out;
}

function textNodes(el) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  return nodes;
}

// Replaces what `re` finds in a text node with what `make(match)` builds.
function replaceIn(node, re, make) {
  const text = node.nodeValue;
  const frag = document.createDocumentFragment();
  let last = 0;
  for (const m of text.matchAll(re)) {
    frag.append(text.slice(last, m.index), make(m[0]));
    last = m.index + m[0].length;
  }
  if (!last) return;
  frag.append(text.slice(last));
  node.replaceWith(frag);
}

function span(className, text) {
  const el = document.createElement("span");
  el.className = className;
  el.textContent = text;
  return el;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordRe = (w) => new RegExp(`(?<![\\p{L}])${escapeRe(w).replace(/\s+/g, "\\s+")}(?![\\p{L}])`, "giu");

function wrapWords(el) {
  for (const node of textNodes(el)) {
    replaceIn(node, WORD, (w) => {
      const s = span("cw", w);
      s.dataset.action = "think-clue";
      s.dataset.w = w;
      s.setAttribute("role", "button");
      return s;
    });
  }
}

// The clue may appear elsewhere in the passage too: the mark goes on the one nearest the blank.
function markClue(el, text) {
  const blank = el.querySelector(".blank");
  const nodes = textNodes(el);
  let at = 0, blankAt = null;
  const hits = [];
  for (const node of nodes) {
    if (blank && blankAt === null && blank.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) blankAt = at;
    for (const m of node.nodeValue.matchAll(wordRe(text))) hits.push({ node, word: m[0], index: m.index, at: at + m.index });
    at += node.nodeValue.length;
  }
  const near = (x) => Math.abs(x.at - (blankAt ?? at));
  const hit = hits.sort((a, b) => near(a) - near(b))[0];
  if (!hit) return;
  const { node, word, index } = hit;
  const rest = node.splitText(index);
  rest.nodeValue = rest.nodeValue.slice(word.length);
  rest.before(span("clue-mark", word));
}

export function createThink({ esc, icon, answerOf, isOriginal, refresh }) {
  const states = new Map();
  let current = null;

  function state(q) {
    current = q;
    if (!states.has(q.id)) {
      const clues = isOriginal(q) ? [] : clueWords(q);
      states.set(q.id, { clues, step: clues.length ? "clue" : "own", picked: null, hit: null, tapped: "", own: "" });
    }
    return states.get(q.id);
  }

  const locked = (q) => !!q && isWic(q) && !answerOf(q) && state(q).step !== "open";

  function html(q) {
    const s = state(q);
    const head = (n) => `<div class="think-head">${icon("target", "icon-sm")}<b>Сначала сами</b>${s.clues.length ? `<span class="muted">Шаг ${n} из 2</span>` : ""}</div>`;
    if (s.step === "clue") {
      return `<section class="card think">${head(1)}
        <p>Нажмите в тексте слово, которое задаёт направление мысли в предложении с пропуском.</p>
      </section>`;
    }
    const kind = s.picked ? KINDS[s.picked.kind] : "";
    const note = s.picked ? `<p class="think-note ${s.hit ? "ok" : "bad"}">${s.hit
      ? `«${esc(s.tapped)}» — да. ${kind}`
      : `«${esc(s.tapped)}» не меняет ход мысли. Здесь подсказка — «${esc(s.picked.text)}». ${kind}`}</p>` : "";
    return `<section class="card think">${head(2)}${note}
      <p>${coveredWord(q) && !isOriginal(q) ? "Слово закрыто. Что бы вы сами поставили на его место?" : "Какое слово вы бы поставили сами?"} Можно по-русски: важна мысль.</p>
      <div class="think-row">
        <input id="think-own" value="${esc(s.own)}" placeholder="Ваше слово" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Ваше слово">
        <button class="btn btn-primary" data-action="think-go">Показать варианты</button>
      </div>
    </section>`;
  }

  // Dresses the rendered question for the step. True when the words were made tappable.
  function decorate(q, root) {
    if (!locked(q) || isOriginal(q)) return false;
    const s = state(q);
    const passage = root.querySelector(".passage");
    const word = coveredWord(q);
    if (word) {
      for (const el of root.querySelectorAll(".passage, .prompt")) {
        for (const node of textNodes(el)) replaceIn(node, wordRe(word), () => span("covered", "▬▬▬▬"));
      }
    }
    if (s.step === "clue" && passage) { wrapWords(passage); return true; }
    if (s.picked && passage) markClue(passage, s.picked.text);
    return false;
  }

  function tap(el) {
    const s = current && state(current);
    if (!s || s.step !== "clue") return;
    const word = el.dataset.w.toLowerCase();
    const hit = s.clues.find((c) => c.text.split(" ").some((w) => w === word && !SMALL.has(w)));
    s.hit = !!hit;
    s.picked = hit || s.clues[0];
    s.tapped = el.dataset.w;
    s.step = "own";
    refresh();
  }

  function go() {
    const s = current && state(current);
    if (!s || s.step !== "own") return;
    if (s.own.trim().length < 2) { document.getElementById("think-own")?.focus(); return; }
    s.step = "open";
    refresh();
  }

  function onInput(e) {
    if (e.target.id !== "think-own" || !current) return false;
    state(current).own = e.target.value;
    return true;
  }

  // What the student did, for the record of the answer; the next attempt starts over.
  function take(q) {
    const s = states.get(q.id);
    states.delete(q.id);
    if (!s?.own.trim()) return {};
    return { own: s.own.trim(), ...(s.clues.length ? { clue: !!s.hit } : {}) };
  }

  return {
    locked, html, decorate, take, go, onInput,
    reset: (id) => states.delete(id),
    actions: { "think-clue": tap, "think-go": go },
  };
}
