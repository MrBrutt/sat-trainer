import { test, eq } from "./run.js";
import { meaningOptions, plainMeaning } from "../assets/meanings.js";

const pool = [
  { p: "adj.", d: "very large" }, { p: "adj.", d: "easy to see" }, { p: "adj.", d: "full of hope" },
  { p: "v.", d: "to move fast" }, { p: "v.", d: "to cut" }, { p: "n.", d: "a small house" },
];
const card = { key: "arduous", def: "needing great effort", pos: "adj." };

test("four different meanings, the word's own among them", () => {
  const o = meaningOptions(card, [], pool);
  eq(o.length, 4);
  eq(new Set(o).size, 4);
  eq(o.includes(card.def), true);
});

test("wrong meanings are of the same part of speech when there are enough", () => {
  const o = meaningOptions(card, [], pool).filter((d) => d !== card.def);
  eq(o.every((d) => pool.find((x) => x.d === d).p === "adj."), true);
});

test("one wrong meaning comes from another choice of the same question", () => {
  const sibling = { key: "facile", def: "too simple", pos: "adj." };
  eq(meaningOptions(card, [sibling], pool).includes(sibling.def), true);
});

test("a dictionary meaning looks like the trainer's own: no part of speech, one meaning, small letter", () => {
  eq(plainMeaning("noun: The state of being accurate; exactness. · verb: To check."), { def: "the state of being accurate; exactness", pos: "n." });
  eq(plainMeaning("adjective: Hard to do"), { def: "hard to do", pos: "adj." });
  eq(plainMeaning("NASA's space agency", "n."), { def: "NASA's space agency", pos: "n." });
  eq(plainMeaning("very large", "adj."), { def: "very large", pos: "adj." });
});

test("a meaning for two parts of speech keeps the first, without its label", () => {
  eq(plainMeaning("v. 1) to produce a result; 2) to give way; n. the amount produced", "v./n."), { def: "1) to produce a result; 2) to give way", pos: "v." });
  eq(plainMeaning("adj. new and original; n. a long fictional book", "adj./n."), { def: "new and original", pos: "adj." });
  eq(plainMeaning("to become or make smaller", "v./n."), { def: "to become or make smaller", pos: "v./n." });
});

test("a long dictionary meaning is cut to the length of the trainer's own, without page styles", () => {
  const pollution = "noun: Physical contamination, now especially the contamination of the environment by harmful substances, or by disruptive levels of noise, light etc. .mw-parser-output .defdate{font-size:smaller}";
  eq(plainMeaning(pollution, "", true), { def: "physical contamination", pos: "n." });
  eq(plainMeaning("verb: To walk slowly and without any particular aim or purpose through the streets of a town at night", "", true).def,
    "to walk slowly and without any particular aim or purpose through the…");
  const long = "1) to produce or provide a result, especially a good one; 2) to give way or surrender under pressure";
  eq(plainMeaning(long, "v.").def, long, "the trainer's own meanings are kept whole");
});
