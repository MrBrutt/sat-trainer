import { test, eq } from "./run.js";
import { buildQuestions } from "../assets/parser.js";

const line = (text, yb) => ({ text, yb, x0: 20, x1: 300, items: [] });

test("a question that runs past its page is counted, not silently lost", () => {
  const pages = [{ lines: [line("Question ID: abc123", 10), line("Question", 30), line("A very long passage.", 50)], uncovered: [] }];
  const out = buildQuestions(pages, new Map());
  eq(out.length, 0);
  eq(out.skipped, 1);
});
