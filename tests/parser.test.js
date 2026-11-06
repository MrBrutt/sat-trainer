import { test, eq } from "./run.js";
import { buildQuestions } from "../assets/parser.js";

const line = (text, yb) => ({ text, yb, x0: 20, x1: 300, items: [] });

test("a question that runs past its page is counted, not silently lost", () => {
  const pages = [{ lines: [line("Question ID: abc123", 10), line("Question", 30), line("A very long passage.", 50)], uncovered: [] }];
  const out = buildQuestions(pages, new Map());
  eq(out.length, 0);
  eq(out.skipped, 1);
});

import { cleanText, renderBox } from "../assets/parser.js";

// A page saved from a browser. The words of these fixtures are made up.
const row = (yb, cells) => {
  const items = cells.map(([x, s]) => ({ s, f: "F", x, x1: x + s.length * 6, w: s.length * 6 }));
  return { yb, items, x0: items[0].x, x1: items[items.length - 1].x1, text: cells.map((c) => c[1]).join(" ") };
};
const t = (yb, s, x = 14) => row(yb, [[x, s]]);
const wide = (yb, s) => { const r = t(yb, s); r.x1 = 560; r.items[0].x1 = 560; r.items[0].w = 546; return r; };
const head = (id) => [
  t(22, `uestion ID ${id}`, 5),
  row(58, [[2, "Assessment"], [112, "Test"], [222, "Domain"], [332, "Skill"], [442, "Difficulty"]]),
  row(90, [[2, "SAT"], [112, "Reading and"], [222, "Expression of"], [332, "Transitions"]]),
  row(106, [[112, "Writing"], [222, "Ideas"]]),
  t(144, `ID: ${id}`, 51),
];
const page = (...lines) => ({ lines, uncovered: new Float32Array(842) });
const asked = (y) => [
  t(y, "Which choice completes the text with the most logical transition?"),
  t(y + 30, "A. However,", 13), t(y + 60, "B. Thus,", 13), t(y + 90, "C. For example,", 13), t(y + 120, "D. Moreover,", 13),
];
const answer = (id, y) => [t(y, `ID: ${id} Answer`, 51), t(y + 22, "Correct Answer: B"), t(y + 50, "Rationale"), t(y + 72, "Choice B is the best answer."), t(y + 100, "Question Difficulty: Hard")];

test("a file saved from Safari is read: block, skill, text, choices, answer, difficulty", () => {
  const [q] = buildQuestions([page(...head("abcd1234"), t(178, "The rain fell all week."), ...asked(210), ...answer("abcd1234", 380))], new Map());
  eq([q.id, q.domain, q.skill, q.section, q.difficulty], ["abcd1234", "Expression of Ideas", "Transitions", "Reading and Writing", "Hard"]);
  eq(q.stem.map((p) => p.runs.map((r) => r.t).join("")), ["The rain fell all week."]);
  eq(q.prompt.runs.map((r) => r.t).join(""), "Which choice completes the text with the most logical transition?");
  eq(q.choices.map((c) => c.letter), ["A", "B", "C", "D"]);
  eq(q.choices[0].runs[0].t, "However,");
  eq(q.correct, "B");
  eq(q.rationale.map((p) => p.runs.map((r) => r.t).join("")), ["Choice B is the best answer."]);
});

test("in a saved file a long line continues its paragraph, and a gap of 20 does not start a new one", () => {
  const [q] = buildQuestions([page(...head("abcd1234"), wide(178, "The rain fell"), t(196, "all week."), t(216, "It stopped."), t(250, "A new paragraph."), ...asked(290), ...answer("abcd1234", 460))], new Map());
  eq(q.stem.map((p) => p.runs.map((r) => r.t).join("")), ["The rain fell all week.\nIt stopped.", "A new paragraph."]);
});

test("a question that runs onto the next page is read whole", () => {
  const pages = [
    page(...head("abcd1234"), t(178, "A long passage."), t(760, "Which choice completes the text with the most logical transition?"), t(790, "A. However,", 13)),
    page(t(40, "B. Thus,", 13), t(70, "C. For example,", 13), t(100, "D. Moreover,", 13), ...answer("abcd1234", 150)),
  ];
  const out = buildQuestions(pages, new Map());
  eq(out.length, 1);
  eq(out.skipped, 0);
  eq(out[0].choices.map((c) => c.letter), ["A", "B", "C", "D"]);
  eq(out[0].correct, "B");
  eq([out[0].src.question.page, out[0].src.more.map((r) => r.page)], [0, [1]]);
});

test("the next question starts where the answer of the last one ends", () => {
  const out = buildQuestions([
    page(...head("aaaa1111"), t(178, "One."), ...asked(210), ...answer("aaaa1111", 380)),
    page(...head("bbbb2222"), t(178, "Two."), ...asked(210), ...answer("bbbb2222", 380)),
  ], new Map());
  eq(out.map((q) => q.id), ["aaaa1111", "bbbb2222"]);
  eq(out[1].stem.map((p) => p.runs.map((r) => r.t).join("")), ["Two."]);
});

test("a College Board export reads as before", () => {
  const pages = [page(
    t(34, "Question ID: abcd1234", 18),
    row(66, [[25, "Assessment"], [130, "Test"], [240, "Domain"], [350, "Skill"], [460, "Difficulty"]]),
    row(90, [[25, "SAT"], [130, "Reading and Writing"], [240, "Craft and Structure"], [350, "Words in Context"], [460, "Hard"]]),
    t(134, "Question", 18), t(148, "The rain fell.", 18), t(204, "Which choice is best?", 18), t(230, "Answer", 18),
    t(244, "A. one", 18), t(268, "B. two", 18), t(292, "C. three", 18), t(316, "D. four", 18),
    t(354, "Correct Answer: C", 18), t(382, "Rationale", 18), t(396, "Choice C is the best answer.", 18),
  )];
  const [q] = buildQuestions(pages, new Map());
  eq([q.id, q.domain, q.skill, q.difficulty, q.correct], ["abcd1234", "Craft and Structure", "Words in Context", "Hard", "C"]);
  eq(q.src.more, []);
});

test("spaces inside a line are kept, except in the export's fonts where pdf.js invents them", () => {
  eq(cleanText("While researching a topic,", false), "While researching a topic,");
  eq(cleanText("impor tance", true), "importance");
  eq(cleanText(" ", true), " ");
});

test("the original view of a saved file shows the whole width", () => {
  eq(renderBox({}), [17, 594]);
  eq(renderBox({ x0: 0, x1: 595 }), [0, 595]);
});
