// Questions with a chart or table. Only the figure is a picture from the PDF: it is everything above
// the first line of the passage. The rest is the normal text of the question.
import { plain, renderRegion } from "./parser.js";

const MIN_PASSAGE = 150;     // characters: shorter last paragraphs are labels of a figure
const HEAD = 24;             // characters that identify the passage's first line
const PAD = 2;               // pt kept above that line
const MIN_HEIGHT = 8;        // pt: less than this is not a part of the figure
const LINE_TOL = 1.5;        // pt: pieces this close share a baseline
const INK = 245;             // a channel below this is drawn, above it is the paper
const PAGE_WIDTH = 595;      // pt
const PICTURE_WIDTH = 1400;  // px of a whole page in a figure, whatever the screen: enough for a phone's zoom

const squash = (s) => s.replace(/\s+/g, "");

// The passage of a question whose figure can stand apart from it: the figure comes first, the
// passage is the last paragraph. Null for any other question.
export function passageOf(q) {
  if (!q.hasFigure || q.stem.length < 2) return null;
  const last = q.stem[q.stem.length - 1];
  return plain(last).trim().length >= MIN_PASSAGE ? last : null;
}

// Text pieces of a page [{x, y, h, s}] as lines [{top, text}], top to bottom.
export function groupLines(items) {
  const rows = [];
  for (const it of [...items].sort((a, b) => a.y - b.y)) {
    const row = rows[rows.length - 1];
    if (row && it.y - row.y <= LINE_TOL) row.items.push(it);
    else rows.push({ y: it.y, h: it.h, items: [it] });
  }
  return rows.map((r) => ({ top: r.y - r.h, text: r.items.sort((a, b) => a.x - b.x).map((i) => i.s).join("") }));
}

// The parts of `regions` above the line that starts `text`. Regions stay whole when it is not found.
export function cutBefore(regions, lines, text) {
  const head = squash(text).slice(0, HEAD);
  const inside = (l, r) => l.page === r.page && l.top >= r.y0 && l.top <= r.y1;
  const hit = lines.find((l) => squash(l.text).startsWith(head) && regions.some((r) => inside(l, r)));
  if (!hit) return regions;
  const at = regions.findIndex((r) => inside(hit, r));
  const cut = { ...regions[at], y1: hit.top - PAD };
  const before = regions.slice(0, at);
  if (cut.y1 - cut.y0 >= MIN_HEIGHT) return [...before, cut];
  return before.length ? before : regions;
}

// The box of what is drawn on a canvas, or null when it is blank.
function inkOf(canvas) {
  const { width: w, height: h } = canvas;
  const d = canvas.getContext("2d").getImageData(0, 0, w, h).data;
  let top = h, bottom = -1, left = w, right = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (d[i] >= INK && d[i + 1] >= INK && d[i + 2] >= INK) continue;
      top = Math.min(top, y); bottom = Math.max(bottom, y);
      left = Math.min(left, x); right = Math.max(right, x);
    }
  }
  return bottom < 0 ? null : { top, bottom, left, right };
}

function blankCanvas(width, height) {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const g = c.getContext("2d");
  g.fillStyle = "#fff";
  g.fillRect(0, 0, width, height);
  return c;
}

// Parts of one question, one under the other, without the blank margins where a page ended.
export function stack(canvases) {
  const parts = canvases.map((c) => ({ c, ink: inkOf(c) })).filter((p) => p.ink);
  if (parts.length < 2) return parts[0]?.c ?? canvases[0];
  const gap = Math.round(parts[0].c.width / 75);
  const spans = parts.map(({ c, ink }, i) => ({ c, from: i ? ink.top : 0, to: i < parts.length - 1 ? ink.bottom + 1 : c.height }));
  const out = blankCanvas(parts[0].c.width, spans.reduce((n, s) => n + s.to - s.from, gap * (parts.length - 1)));
  const g = out.getContext("2d");
  let y = 0;
  for (const { c, from, to } of spans) {
    g.drawImage(c, 0, from, c.width, to - from, 0, y, c.width, to - from);
    y += to - from + gap;
  }
  return out;
}

export function cropToInk(canvas) {
  const ink = inkOf(canvas);
  if (!ink) return canvas;
  const w = ink.right - ink.left + 1, h = ink.bottom - ink.top + 1;
  const out = blankCanvas(w, h);
  out.getContext("2d").drawImage(canvas, ink.left, ink.top, w, h, 0, 0, w, h);
  return out;
}

const regionsOf = (q) => [q.src.question, ...(q.src.more || [])];

async function draw(pdf, regions, cssWidth, dpr) {
  const canvases = [];
  for (const r of regions) canvases.push(await renderRegion(pdf, r, cssWidth, dpr));
  return stack(canvases);
}

// The whole question as it stands in the PDF, in one block.
export async function drawQuestion(pdf, q, cssWidth) {
  const out = await draw(pdf, regionsOf(q), cssWidth);
  out.style.width = "100%";
  return out;
}

async function linesOn(pdf, regions) {
  const lines = [];
  for (const n of new Set(regions.map((r) => r.page))) {
    const page = await pdf.getPage(n + 1);
    const vp = page.getViewport({ scale: 1 });
    const { items } = await page.getTextContent();
    const pieces = items.filter((i) => i.str.trim()).map((i) => {
      const [x, y] = vp.convertToViewportPoint(i.transform[4], i.transform[5]);
      return { x, y, h: Math.abs(i.transform[3]), s: i.str };
    });
    for (const l of groupLines(pieces)) lines.push({ page: n, ...l });
  }
  return lines;
}

// The chart or table alone. Its size follows the PDF, not the screen: a small chart does not blow
// up on a wide page, and a wide table scrolls on a phone instead of shrinking past reading.
export async function drawFigure(pdf, q) {
  const whole = regionsOf(q);
  const regions = cutBefore(whole, await linesOn(pdf, whole), plain(passageOf(q)));
  const out = cropToInk(await draw(pdf, regions, PICTURE_WIDTH, 1));
  const points = (out.width * PAGE_WIDTH) / PICTURE_WIDTH;
  Object.assign(out.style, { width: "100%", maxWidth: `${Math.round(points * 1.3)}px`, minWidth: `${Math.round(points * 0.75)}px` });
  return out;
}
