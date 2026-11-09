import { test, eq } from "./run.js";
import { passageOf, groupLines, cutBefore, stack, cropToInk } from "../assets/figure.js";

const para = (t) => ({ runs: [{ t }] });
const PASSAGE = "In tomato plants, herbivory induces defensive production of jasmonic acid, while microbial infection induces defensive production of salicylic acid in nearby plants.";
const figureQuestion = (stem) => ({ hasFigure: true, stem: stem.map(para) });

test("only the passage is text: the chart's labels stay in the picture", () => {
  const q = figureQuestion(["Acid Levels in Tomato Plants", "250", "control plants", PASSAGE]);
  eq(passageOf(q).runs[0].t, PASSAGE);
});

test("a question without a figure has nothing to separate", () => {
  eq(passageOf({ hasFigure: false, stem: [para("x"), para(PASSAGE)] }), null);
});

test("a figure below the passage keeps the full original view", () => {
  eq(passageOf(figureQuestion([PASSAGE, "250", "control plants"])), null);
});

test("a figure with no text around it keeps the full original view", () => {
  eq(passageOf(figureQuestion([PASSAGE])), null);
});

test("pieces of one line are joined, whatever their order", () => {
  const items = [
    { x: 60, y: 100.4, h: 12, s: "fly" }, { x: 14, y: 100, h: 12, s: "white" },
    { x: 14, y: 120, h: 12, s: "next line" },
  ];
  eq(groupLines(items), [{ top: 88, text: "whitefly" }, { top: 108, text: "next line" }]);
});

const R = (page, y0, y1) => ({ page, y0, y1, x0: 0, x1: 595 });
const line = (page, top, text) => ({ page, top, text });

test("the picture ends above the passage's first line", () => {
  const regions = [R(3, 100, 842)];
  const lines = [line(3, 120, "Acid Levels"), line(3, 400, "In tomato plants, herbivory induces defensive")];
  eq(cutBefore(regions, lines, PASSAGE), [R(3, 100, 398)]);
});

test("spaces do not matter when looking for the passage", () => {
  const regions = [R(3, 100, 842)];
  eq(cutBefore(regions, [line(3, 400, "In tomato  plants,herbivory induces defensive")], PASSAGE), [R(3, 100, 398)]);
});

test("a figure that runs onto the next page keeps both parts", () => {
  const regions = [R(3, 100, 842), R(4, 0, 300)];
  eq(cutBefore(regions, [line(4, 200, "In tomato plants, herbivory induces")], PASSAGE), [R(3, 100, 842), R(4, 0, 198)]);
});

test("a passage at the top of the next page drops that page", () => {
  const regions = [R(3, 100, 842), R(4, 0, 300)];
  eq(cutBefore(regions, [line(4, 4, "In tomato plants, herbivory induces")], PASSAGE), [R(3, 100, 842)]);
});

test("a passage that is not found leaves the regions whole", () => {
  const regions = [R(3, 100, 842)];
  eq(cutBefore(regions, [line(3, 400, "Something else entirely")], PASSAGE), regions);
});

test("a passage at the very top leaves nothing to cut away", () => {
  const regions = [R(3, 100, 500)];
  eq(cutBefore(regions, [line(3, 102, "In tomato plants, herbivory induces")], PASSAGE), regions);
});

test("the same words outside the question do not count", () => {
  const regions = [R(3, 100, 500)];
  eq(cutBefore(regions, [line(3, 700, "In tomato plants, herbivory induces")], PASSAGE), regions);
});

// A white canvas with black boxes [x, y, w, h].
function paint(w, h, boxes) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, w, h);
  g.fillStyle = "#000";
  for (const b of boxes) g.fillRect(...b);
  return c;
}
const dark = (c, x, y) => c.getContext("2d").getImageData(x, y, 1, 1).data[0] < 128;

test("parts are joined without their blank margins", () => {
  const first = paint(150, 20, [[0, 0, 150, 10]]);      // rows 10-19 blank
  const second = paint(150, 20, [[0, 15, 150, 5]]);     // rows 0-14 blank
  const out = stack([first, second]);
  eq(out.height, 10 + 2 + 5, "blank rows go, a gap of one line's air stays");
  eq([dark(out, 5, 9), dark(out, 5, 10), dark(out, 5, 11), dark(out, 5, 12)], [true, false, false, true]);
});

test("the outer margins of the block stay", () => {
  const first = paint(150, 20, [[0, 5, 150, 15]]);
  const last = paint(150, 20, [[0, 0, 150, 15]]);
  eq(stack([first, last]).height, 20 + 2 + 20);
});

test("one part is left as it is", () => {
  const only = paint(150, 20, [[0, 5, 150, 5]]);
  eq(stack([only]), only);
});

test("a picture is cropped to what is drawn on it", () => {
  const out = cropToInk(paint(20, 20, [[5, 3, 5, 5]]));
  eq([out.width, out.height], [5, 5]);
  eq(dark(out, 0, 0), true);
});

test("a blank picture is left alone", () => {
  const blank = paint(20, 20, []);
  eq(cropToInk(blank), blank);
});
