// Turns a College Board "Educator Question Bank" PDF export into structured questions.
// Everything runs locally in the browser — the file never leaves the device.
import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.worker.min.mjs";

export { pdfjsLib };

const SCALE = 2;             // render scale used for style detection
const ITALIC_Q = 1.07;       // slant score above which a font is italic
const BOLD_DENSITY = 0.345;  // ink density above which a font is bold
const LINE_TOL = 1.5;        // pt — items closer than this share a baseline
const CONTENT_X0 = 17, CONTENT_X1 = 595;
// Two layouts of the same questions. paraGap: pt, the baseline gap that starts a new paragraph;
// hardBreak: pt, a line ending before this is an intentional break (poems, notes); figure: how much
// ink outside the text makes a figure.
const EXPORT = { saved: false, paraGap: 20, hardBreak: 500, figure: 600 };
const SAVED = { saved: true, paraGap: 21.5, hardBreak: 515, figure: 2500, box: { x0: 0, x1: 595 } };   // the page saved from a browser

export function openPdf(bytes) {
  // pdf.js transfers the buffer to its worker, so hand it a copy
  return pdfjsLib.getDocument({ data: bytes.slice(0), isEvalSupported: false }).promise;
}

export async function parseQuestionBank(bytes, onProgress = () => {}) {
  const pdf = await openPdf(bytes);
  const fontStats = new Map();
  const pages = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    pages.push(await analyzePage(page, fontStats));
    page.cleanup();
    onProgress(p / pdf.numPages);
  }
  const fonts = classifyFonts(fontStats);
  const questions = buildQuestions(pages, fonts);
  canonicalize(questions, ["skill", "domain", "section", "difficulty"]);
  await pdf.destroy();
  if (!questions.length) {
    const sawIds = pages.some((pg) => pg.lines.some((l) => RE_ID.test(l.text)));
    throw new Error(sawIds ? "NO_ANSWERS" : "NOT_QUESTION_BANK");
  }
  return { questions, pageCount: pages.length, skipped: questions.skipped };
}

// Same label spelled differently ("Cross-text" vs "Cross-Text") -> most common spelling.
function canonicalize(questions, keys) {
  for (const k of keys) {
    const counts = new Map();
    for (const q of questions) {
      const key = q[k].toLowerCase();
      const m = counts.get(key) || new Map();
      m.set(q[k], (m.get(q[k]) || 0) + 1);
      counts.set(key, m);
    }
    for (const q of questions) {
      const m = counts.get(q[k].toLowerCase());
      q[k] = [...m.entries()].sort((a, b) => b[1] - a[1])[0][0];
    }
  }
}

// ---------------------------------------------------------------- page analysis

// The export's Type3 fonts: real spaces arrive as their own items, and pdf.js invents spaces inside
// words from kerning ("impor tance"). Ordinary fonts (a page saved from a browser) keep their spaces.
export const cleanText = (s, type3) => (type3 && s.trim() ? s.replace(/(\S)\s+(?=\S)/g, "$1") : s);

function fontOf(page, name) {
  try { return page.commonObjs.get(name); } catch { return null; }
}

async function analyzePage(page, fontStats) {
  const vp1 = page.getViewport({ scale: 1 });
  const PW = vp1.width, PH = vp1.height;
  const vp = page.getViewport({ scale: SCALE });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(vp.width);
  canvas.height = Math.ceil(vp.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // "print" intent renders without requestAnimationFrame, so import keeps going in a background tab
  await page.render({ canvasContext: ctx, viewport: vp, intent: "print" }).promise;

  const W = canvas.width, H = canvas.height;
  const rgba = ctx.getImageData(0, 0, W, H).data;
  const ink = new Uint8Array(W * H);
  for (let i = 0, j = 0; i < ink.length; i++, j += 4) ink[i] = 255 - rgba[j + 1];
  canvas.width = canvas.height = 0;

  const tc = await page.getTextContent();
  const items = [];
  for (const it of tc.items) {
    if (!it.str) continue;
    const x = it.transform[4];
    const s = cleanText(it.str, fontOf(page, it.fontName)?.isType3Font ?? true);
    items.push({ s, f: it.fontName, x, x1: x + it.width, w: it.width, yb: PH - it.transform[5] });
  }

  // per-item style metrics, aggregated per font
  for (const it of items) {
    const letters = it.s.replace(/[^A-Za-z]/g, "").length;
    if (letters < 2) continue;
    const st = fontStats.get(it.f) || { n: 0, q: 0, dens: 0, name: fontOf(page, it.f)?.name || "" };
    fontStats.set(it.f, st);
    const m = measureItem(ink, W, H, it);
    if (!m) continue;
    st.n++; st.q += m.q; st.dens += m.dens;
  }

  const lines = groupLines(items);
  for (const ln of lines) ln.ul = underlineRuns(ink, W, H, ln);
  const uncovered = uncoveredInkProfile(ink, W, H, items, PH);
  return { PW, PH, lines, uncovered };
}

function measureItem(ink, W, H, it) {
  const yb = Math.round(it.yb * SCALE);
  const h = Math.round(9 * 0.72 * SCALE);
  const top = yb - h;
  const X0 = Math.round(it.x * SCALE), X1 = Math.round(it.x1 * SCALE);
  if (X1 - X0 < 4 || top < 0 || yb >= H) return null;
  const at = (x, y) => (x < 0 || x >= W ? 0 : ink[y * W + x] / 255);
  const score = (s) => {
    let tot = 0, sq = 0;
    for (let x = X0 - 10; x < X1 + 10; x++) {
      let col = 0;
      for (let y = top; y < yb; y++) col += at(Math.round(x + s * (yb - y)), y);
      sq += col * col; tot += col;
    }
    return tot ? sq / tot : 0;
  };
  const sp = score(0.21), sm = score(-0.21);
  let sum = 0, area = 0;
  for (let y = top; y < yb; y++) for (let x = X0; x < X1; x++) { sum += at(x, y); area++; }
  return { q: sm ? sp / sm : 1, dens: area ? sum / area : 0 };
}

function groupLines(items) {
  const sorted = items.filter((i) => i.s.trim() || i.w > 0).sort((a, b) => a.yb - b.yb || a.x - b.x);
  const lines = [];
  for (const it of sorted) {
    let ln = lines.length ? lines[lines.length - 1] : null;
    if (!ln || Math.abs(it.yb - ln.yb) > LINE_TOL) {
      ln = { yb: it.yb, items: [] };
      lines.push(ln);
    }
    ln.items.push(it);
  }
  const finalize = (ln) => {
    ln.items.sort((a, b) => a.x - b.x);
    // drop leading/trailing whitespace-only items (header table uses them as column fillers)
    while (ln.items.length && !ln.items[0].s.trim()) ln.items.shift();
    while (ln.items.length && !ln.items[ln.items.length - 1].s.trim()) ln.items.pop();
    ln.x0 = ln.items.length ? ln.items[0].x : 0;
    ln.x1 = ln.items.length ? Math.max(...ln.items.map((i) => i.x1)) : 0;
    ln.text = lineText(ln.items).trim();
  };
  lines.forEach(finalize);
  // Sub/superscripts sit a few pt off the baseline: fold short satellite lines into their host line.
  const out = lines.filter((l) => l.text);
  for (let i = 0; i < out.length; i++) {
    const s = out[i];
    const short = s.items.every((it) => it.s.trim().length <= 4) && s.text.replace(/\s/g, "").length <= 12;
    if (!short) continue;
    const host = out
      .filter((m) => m !== s && m.text.length > s.text.length * 2 && Math.abs(m.yb - s.yb) >= LINE_TOL &&
        Math.abs(m.yb - s.yb) <= 6 && s.x0 >= m.x0 - 6 && s.x1 <= m.x1 + 6)
      .sort((a, b) => Math.abs(a.yb - s.yb) - Math.abs(b.yb - s.yb))[0];
    if (!host) continue;
    for (const it of s.items) { it.v = s.yb > host.yb ? "sub" : "sup"; host.items.push(it); }
    finalize(host);
    out.splice(i, 1);
    i--;
  }
  return out;
}

function lineText(items) {
  let out = "";
  items.forEach((it, i) => {
    if (i && needsSpace(items[i - 1], it)) out += " ";
    out += it.s;
  });
  return out;
}

function needsSpace(a, b) {
  return b.x - a.x1 > 1.8 && !/\s$/.test(a.s) && !/^\s/.test(b.s);
}

// Underlines are thin dark runs just below the baseline.
function underlineRuns(ink, W, H, ln) {
  const y0 = Math.round(ln.yb * SCALE) + 1, y1 = Math.round(ln.yb * SCALE) + 7;
  const X0 = Math.max(0, Math.round(ln.x0 * SCALE) - 2), X1 = Math.min(W, Math.round(ln.x1 * SCALE) + 2);
  const MIN = 9;
  let best = [];
  for (let y = y0; y <= y1 && y < H; y++) {
    const runs = [];
    let start = -1;
    for (let x = X0; x <= X1; x++) {
      const dark = x < X1 && ink[y * W + x] > 128;
      if (dark && start < 0) start = x;
      if (!dark && start >= 0) { if (x - start >= MIN) runs.push([start, x]); start = -1; }
    }
    const cover = runs.reduce((s, r) => s + r[1] - r[0], 0);
    if (cover > best.reduce((s, r) => s + r[1] - r[0], 0)) best = runs;
  }
  return best.map(([a, b]) => [a / SCALE, b / SCALE]);
}

// Ink that is not explained by text (figures, tables, graphs) — per pt row.
function uncoveredInkProfile(ink, W, H, items, PH) {
  const mask = new Uint8Array(W * H);
  for (const it of items) {
    if (!it.s.trim()) continue;
    const x0 = Math.max(0, Math.floor((it.x - 1.5) * SCALE)), x1 = Math.min(W, Math.ceil((it.x1 + 1.5) * SCALE));
    const y0 = Math.max(0, Math.floor((it.yb - 9.5) * SCALE)), y1 = Math.min(H, Math.ceil((it.yb + 4) * SCALE));
    for (let y = y0; y < y1; y++) mask.fill(1, y * W + x0, y * W + x1);
  }
  const rows = new Float32Array(Math.ceil(PH));
  for (let y = 0; y < H; y++) {
    let c = 0;
    for (let x = 0; x < W; x++) if (ink[y * W + x] > 128 && !mask[y * W + x]) c++;
    rows[Math.min(rows.length - 1, Math.floor(y / SCALE))] += c;
  }
  return rows;
}

function classifyFonts(stats) {
  const out = new Map();
  for (const [f, s] of stats) {
    // a real font says what it is; only the export's nameless fonts have to be measured
    if (/regular|italic|oblique|bold/i.test(s.name)) {
      out.set(f, { italic: /italic|oblique/i.test(s.name), bold: /bold/i.test(s.name) });
      continue;
    }
    if (!s.n) continue;
    const q = s.q / s.n, dens = s.dens / s.n;
    out.set(f, { italic: q > ITALIC_Q, bold: dens > BOLD_DENSITY });
  }
  return out;
}

// ---------------------------------------------------------------- document structure

// A page saved from a browser cuts off the Q of the title.
const RE_ID = /^Q?uestion ID:?\s*([0-9a-f]{6,})/i;
const RE_CORRECT = /^Correct Answer:\s*(.*)$/i;
const RE_BOX = /^ID:\s*[0-9a-f]{6,}$/i;                    // saved page: stands where the export says "Question"
const RE_BOX_ANSWER = /^ID:\s*[0-9a-f]{6,}\s+Answer$/i;    // saved page: closes the question
const RE_LEVEL = /^Question Difficulty:\s*(\w+)/i;         // saved page: the table shows it as bars

// A question whose answer cannot be found is left out: `skipped` counts them.
export function buildQuestions(pages, fonts) {
  const questions = [];
  questions.skipped = 0;
  const lines = pages.flatMap((pg, pi) => pg.lines.map((l) => ({ ...l, page: pi })));
  const starts = lines.flatMap((l, i) => (RE_ID.test(l.text) ? [i] : []));
  starts.forEach((start, n) => {
    const part = readQuestion(lines.slice(start, starts[n + 1] ?? lines.length), pages);
    if (part) questions.push(finish(part, fonts, pages));
    else questions.skipped++;
  });
  return questions;
}

// The lines of one question, from its title to the next one, possibly over several pages.
function readQuestion(L, pages) {
  const find = (pred, from) => L.findIndex((l, i) => i > from && pred(l));
  const qIdx = find((l) => l.text === "Question" || RE_BOX.test(l.text), 0);
  const cIdx = find((l) => RE_CORRECT.test(l.text), qIdx);
  if (qIdx < 0 || cIdx < 0) return null;
  const layout = RE_BOX.test(L[qIdx].text) ? SAVED : EXPORT;
  const box = layout.saved ? find((l) => RE_BOX_ANSWER.test(l.text), qIdx) : -1;
  const end = box >= 0 ? box : cIdx;
  const label = layout.saved ? -1 : L.findIndex((l, i) => i > qIdx && i < cIdx && l.text === "Answer");
  const first = layout.saved ? L.findIndex((l, i) => i > qIdx && i < end && /^A\.\s/.test(l.text) && l.x0 < CONTENT_X0 + 10) : label + 1;
  const hasChoices = layout.saved ? first >= 0 : label >= 0;
  const rIdx = find((l) => l.text === "Rationale", cIdx);
  const rest = rIdx >= 0 ? L.slice(rIdx + 1) : [];
  const level = rest.map((l) => l.text.match(RE_LEVEL)).find(Boolean);
  return {
    id: L[0].text.match(RE_ID)[1],
    layout,
    level: level?.[1] || "",
    meta: parseHeader(L.slice(1, qIdx)),
    stemLines: L.slice(qIdx + 1, hasChoices ? first - (layout.saved ? 0 : 1) : end),
    choiceLines: hasChoices ? L.slice(first, end) : [],
    correct: L[cIdx].text.match(RE_CORRECT)[1].trim(),
    ratLines: rest.filter((l) => !RE_LEVEL.test(l.text)),
    src: { page: L[0].page, ...questionRegions(L, qIdx, end, layout, pages), rationale: rationaleRegions(L, rIdx) },
  };
}

// Where the question stands on its pages, for the original view.
function questionRegions(L, qIdx, end, { saved, box }, pages) {
  const top = L[qIdx], bottom = L[end];
  const y0 = top.yb + (saved ? 14 : 3), y1 = bottom.yb - (saved ? 20 : 10);
  if (top.page === bottom.page) return { question: { page: top.page, y0, y1, ...box }, more: [] };
  const height = (page) => pages[page].PH || 842;
  const more = [];
  for (let page = top.page + 1; page <= bottom.page; page++) more.push({ page, y0: 0, y1: page === bottom.page ? y1 : height(page), ...box });
  return { question: { page: top.page, y0, y1: height(top.page), ...box }, more };
}

function rationaleRegions(L, rIdx) {
  if (rIdx < 0) return [];
  const byPage = new Map();
  for (const l of L.slice(rIdx)) (byPage.get(l.page) || byPage.set(l.page, []).get(l.page)).push(l);
  return [...byPage].map(([page, ls], i) => ({ page, y0: i ? ls[0].yb - 11 : L[rIdx].yb + 3, y1: ls[ls.length - 1].yb + 4 }));
}

function finish(c, fonts, pages) {
  const { layout } = c;
  const stem = paragraphs(c.stemLines, fonts, layout);
  // the question prompt is the last stem paragraph that asks something
  let promptIdx = -1;
  for (let i = stem.length - 1; i >= 0; i--) if (/\?\s*$/.test(plain(stem[i]))) { promptIdx = i; break; }
  const prompt = promptIdx >= 0 ? stem.splice(promptIdx, 1)[0] : null;
  const choices = splitChoices(c.choiceLines, fonts, layout);
  const letter = /^[A-D]$/.test(c.correct) ? c.correct : null;
  let figureInk = 0;
  for (const q of [c.src.question, ...c.src.more]) {
    const rows = pages[q.page].uncovered;
    for (let y = Math.max(0, Math.floor(q.y0)); y < Math.min(rows.length, Math.ceil(q.y1)); y++) figureInk += rows[y];
  }
  return {
    id: c.id,
    assessment: c.meta.assessment || "",
    section: c.meta.test || c.meta.section || "",
    domain: c.meta.domain || "",
    skill: c.meta.skill || "",
    difficulty: c.meta.difficulty || c.level,
    stem,
    prompt,
    choices,
    correct: letter,
    correctText: letter ? null : c.correct,
    rationale: paragraphs(c.ratLines, fonts, layout),
    hasFigure: figureInk > layout.figure,
    src: c.src,
  };
}

function parseHeader(lines) {
  if (!lines.length) return {};
  // first line holds the column labels; wide gaps separate the columns
  const labelLine = lines[0];
  const cols = [];
  let group = null;
  labelLine.items.forEach((it, i) => {
    const prev = labelLine.items[i - 1];
    const wideGap = !prev || it.x - prev.x1 > 12 || (!prev.s.trim() && prev.w > 12);
    if (!it.s.trim()) return;
    if (!group || wideGap) { group = { x: it.x, items: [] }; cols.push(group); }
    group.items.push(it);
  });
  cols.forEach((c) => (c.key = lineText(c.items).trim().toLowerCase()));
  const vals = cols.map(() => []);
  for (const ln of lines.slice(1)) {
    const per = cols.map(() => []);
    for (const it of ln.items) {
      if (!it.s.trim() && !per.some((p) => p.length)) continue;
      let ci = 0;
      cols.forEach((c, k) => { if (it.x >= c.x - 2) ci = k; });
      per[ci].push(it);
    }
    per.forEach((p, k) => { const t = lineText(p).trim(); if (t) vals[k].push(t); });
  }
  const out = {};
  cols.forEach((c, k) => (out[c.key] = vals[k].join(" ").replace(/\s+/g, " ").trim()));
  return out;
}

function styleOf(it, fonts, ln) {
  const f = fonts.get(it.f) || {};
  let u = false;
  if (ln.ul && ln.ul.length && it.w > 0) {
    let ov = 0;
    for (const [a, b] of ln.ul) ov += Math.max(0, Math.min(b, it.x1) - Math.max(a, it.x));
    u = !it.v && ov >= it.w * 0.5;
  }
  return { i: !!f.italic, b: !!f.bold, u, v: it.v || "" };
}

function pushRun(runs, t, st) {
  const last = runs[runs.length - 1];
  const v = st.v || "";
  if (last && last.i === st.i && last.b === st.b && last.u === st.u && (last.v || "") === v) last.t += t;
  else runs.push({ t, i: st.i, b: st.b, u: st.u, v });
}

function lineRuns(ln, fonts, skip = 0) {
  const runs = [];
  const items = ln.items.slice(skip);
  items.forEach((it, i) => {
    const st = styleOf(it, fonts, ln);
    if (i && needsSpace(items[i - 1], it)) {
      const pst = styleOf(items[i - 1], fonts, ln);
      pushRun(runs, " ", { i: st.i && pst.i, b: st.b && pst.b, u: st.u && pst.u, v: "" });
    }
    pushRun(runs, it.s, st);
  });
  return runs;
}

// Joins visual lines into paragraphs, keeping intentional line breaks (poetry).
function paragraphs(lines, fonts, layout) {
  const paras = [];
  let cur = null, prev = null;
  for (const ln of lines) {
    const samePage = prev && prev.page === ln.page;
    const gap = samePage ? ln.yb - prev.yb : 0;
    const newPara = !cur || (samePage ? gap > layout.paraGap : prev.x1 < layout.hardBreak);
    if (newPara) {
      cur = { lines: [], gap };
      paras.push(cur);
    }
    cur.lines.push(ln);
    prev = ln;
  }
  return paras
    .map((p) => ({
      ...tidy(joinLines(p.lines, fonts, layout)),
      // indented blocks are verse or quoted lines; keep them visually apart
      indent: Math.min(...p.lines.map((l) => l.x0)) > CONTENT_X0 + 14,
      gap: Math.round(p.gap),
    }))
    .filter((p) => p.runs.length);
}

function joinLines(lines, fonts, layout) {
  const runs = [];
  lines.forEach((ln, i) => {
    if (i) {
      const prevText = lines[i - 1].text;
      if (lines[i - 1].x1 < layout.hardBreak) pushRun(runs, "\n", { i: false, b: false, u: false, v: "" });
      else if (!/[-‐–—\/]$/.test(prevText)) {
        const a = runs[runs.length - 1] || {};
        const b = lineRuns(ln, fonts)[0] || {};
        pushRun(runs, " ", { i: !!(a.i && b.i), b: !!(a.b && b.b), u: !!(a.u && b.u), v: "" });
      }
    }
    for (const r of lineRuns(ln, fonts)) pushRun(runs, r.t, r);
  });
  return { runs };
}

function splitChoices(lines, fonts, layout) {
  const choices = [];
  let cur = null;
  for (const ln of lines) {
    const m = ln.text.match(/^([A-D])\.\s*/);
    if (m && ln.x0 < CONTENT_X0 + 10) {
      cur = { letter: m[1], lines: [] };
      choices.push(cur);
    }
    if (cur) cur.lines.push(ln);
  }
  return choices.map((c) => {
    const para = tidy(joinLines(c.lines, fonts, layout));
    // strip the "A." label from the first run(s)
    let strip = (c.letter + ".").length;
    while (strip > 0 && para.runs.length) {
      const r = para.runs[0];
      if (r.t.length <= strip) { strip -= r.t.length; para.runs.shift(); }
      else { r.t = r.t.slice(strip); strip = 0; }
    }
    if (para.runs.length) para.runs[0].t = para.runs[0].t.replace(/^\s+/, "");
    return { letter: c.letter, runs: tidy(para).runs };
  });
}

function tidy(p) {
  const runs = p.runs.filter((r) => r.t.length);
  if (runs.length) {
    runs[0].t = runs[0].t.replace(/^[ \t]+/, "");
    runs[runs.length - 1].t = runs[runs.length - 1].t.replace(/[ \t]+$/, "");
  }
  return { runs: runs.filter((r) => r.t.length) };
}

export function plain(p) {
  return p ? p.runs.map((r) => r.t).join("") : "";
}

// ---------------------------------------------------------------- original-view rendering

// The width to show of a page: a saved page uses all of it.
export const renderBox = (region) => [region.x0 ?? CONTENT_X0, region.x1 ?? CONTENT_X1 - 1];

export async function renderRegion(pdf, region, cssWidth) {
  const page = await pdf.getPage(region.page + 1);
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const [x0, x1] = renderBox(region);
  const scale = (cssWidth / (x1 - x0)) * dpr;
  const vp = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil((x1 - x0) * scale);
  canvas.height = Math.ceil((region.y1 - region.y0) * scale);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({
    canvasContext: ctx,
    viewport: vp,
    intent: "print", // no requestAnimationFrame: finishes even while the tab is in the background
    transform: [1, 0, 0, 1, -x0 * scale, -region.y0 * scale],
  }).promise;
  canvas.style.width = "100%";
  return canvas;
}
