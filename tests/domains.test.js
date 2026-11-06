import { test, eq } from "./run.js";
import { DOMAINS, domainOf, outline, inFocus } from "../assets/domains.js";

const q = (id, skill, domain = "") => ({ id, skill, domain });
const names = (tree) => tree.map((d) => d.name);
const FOUR = ["Craft and Structure", "Information and Ideas", "Standard English Conventions", "Expression of Ideas"];

test("the four blocks are there with no questions at all", () => {
  const tree = outline([], {});
  eq(names(tree), FOUR);
  eq(tree[2].skills.map((s) => s.name), ["Boundaries", "Form, Structure, and Sense"]);
  eq(tree.map((d) => d.count), [0, 0, 0, 0]);
});

test("a block and its skills count questions, answers and right answers", () => {
  const qs = [q("a", "Words in Context"), q("b", "Words in Context"), q("c", "Transitions"), q("d", "Cross-Text Connections")];
  const tree = outline(qs, { a: { ok: true }, b: { ok: false }, c: { ok: true } });
  eq({ count: tree[0].count, done: tree[0].done, ok: tree[0].ok }, { count: 3, done: 2, ok: 1 });
  const wic = tree[0].skills.find((s) => s.name === "Words in Context");
  eq({ count: wic.count, done: wic.done, ok: wic.ok }, { count: 2, done: 2, ok: 1 });
  eq(tree[3].skills.find((s) => s.name === "Transitions").ok, 1);
  eq(tree[1].count, 0);
});

test("skill names match whatever their case", () => {
  eq(domainOf(q("a", "words in context")), "Craft and Structure");
  eq(outline([q("a", "words in context")], {})[0].skills[0].count, 1);
});

test("both kinds of Command of Evidence fall under Information and Ideas", () => {
  const qs = [q("a", "Command of Evidence: Textual"), q("b", "Command of Evidence: Quantitative"), q("c", "Command of Evidence")];
  const row = outline(qs, {})[1].skills.find((s) => s.name === "Command of Evidence");
  eq(row.count, 3);
  eq(qs.every((x) => inFocus(x, "Information and Ideas", "Command of Evidence")), true);
});

test("an unknown skill of a known block joins that block", () => {
  const tree = outline([q("a", "Something New", "Expression of Ideas")], {});
  eq(names(tree), FOUR);
  eq(tree[3].skills.map((s) => s.name), ["Rhetorical Synthesis", "Transitions", "Something New"]);
  eq(tree[3].count, 1);
});

test("skills outside the four blocks get a group of their own", () => {
  const tree = outline([q("a", "Linear functions", "Algebra"), q("b", "No domain at all")], {});
  eq(names(tree), [...FOUR, "Algebra", "Другое"]);
  eq(tree[4].skills.map((s) => s.name), ["Linear functions"]);
  eq(inFocus(q("a", "Linear functions", "Algebra"), "Algebra", "all"), true);
});

test("a skill alone selects its block", () => {
  eq(domainOf({ skill: "Inferences" }), "Information and Ideas");
});

test("focus: everything, a block, or one skill", () => {
  const wic = q("a", "Words in Context"), tr = q("b", "Transitions");
  eq(inFocus(wic, "all", "all"), true);
  eq(inFocus(wic, undefined, undefined), true, "a saved filter from before blocks");
  eq(inFocus(wic, "Craft and Structure", "all"), true);
  eq(inFocus(tr, "Craft and Structure", "all"), false);
  eq(inFocus(wic, "all", "Words in Context"), true);
  eq(inFocus(tr, "all", "Words in Context"), false);
  eq(inFocus(wic, "Craft and Structure", "Words in Context"), true);
});

test("the blocks hold every skill the trainer orders", () => {
  eq(DOMAINS.flatMap((d) => d.skills).length, 10);
});

import { choiceWords, loadFrequencies } from "../assets/words.js";

const withChoices = (skill, domain) => ({ id: "a", skill, domain, stem: [], choices: [{ letter: "A", runs: [{ t: "to assess and modify" }] }] });

test("grammar questions do not ask to learn the words of their choices", async () => {
  await loadFrequencies();
  eq(choiceWords(withChoices("Boundaries", "Standard English Conventions"), 4.6), []);
  eq(choiceWords(withChoices("Form, Structure, and Sense", ""), 4.6), []);
  eq(choiceWords(withChoices("Central Ideas and Details", "Information and Ideas"), 4.6).includes("assess"), true);
});
