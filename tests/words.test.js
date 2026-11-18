import { test, eq } from "./run.js";
import { hardWordsIn, choiceWords, loadFrequencies } from "../assets/words.js";

const hard = async (text) => { await loadFrequencies(); return hardWordsIn(text, 4.23).map((h) => h.key); };
const choice = (t) => ({ runs: [{ t }] });

test("plain words are not hard, however rare they are in everyday English", async () => {
  eq(await hard("the farmworker told researchers about the nineteenth harvest"), ["harvest"]);
});

test("a hyphenated word of plain parts is plain", async () => {
  eq(await hard("a twentieth-century house"), []);
});

test("a hyphenated word is learned by its hard part", async () => {
  eq(await hard("Scientists saw subduction-like movement."), ["subduction"]);
});

test("the example keeps the whole hyphenated word around the hard part", async () => {
  await loadFrequencies();
  const [h] = hardWordsIn("Scientists saw subduction-like movement.", 4.23);
  eq([h.before, h.form, h.after], ["Scientists saw ", "subduction", "-like movement."]);
});

test("every hard part of a hyphenated word is learned", async () => {
  eq(await hard("whitefly-infested leaves"), ["whitefly", "infested"]);
});

test("a word met alone is not met again inside a hyphenated one", async () => {
  eq(await hard("the subduction zone and subduction-like motion"), ["subduction"]);
});

test("a prefix is not a word of its own", async () => {
  eq(await hard("socio-political change in non-indigenous plants"), ["indigenous"]);
});

test("a capitalized part of a hyphenated word is a name", async () => {
  eq(await hard("trans-Neptunian objects"), []);
});

test("set expressions keep a card of their own", async () => {
  eq(await hard("a tailor-made plan, a fully-fledged bird"), ["tailor-made", "fully-fledged"]);
});

test("names and numbers a passage starts with are no words to learn", async () => {
  eq(await hard("Seneca sculptor Marie Watt and musings on tenth-century life"), ["sculptor", "musing"]);
});

test("a rare plural in -uses comes back to its word", async () => {
  eq(await hard("the platypuses"), ["platypus"]);
});

test("real vocabulary stays, even when built from common parts", async () => {
  eq(await hard("the drawback and hardship of scholarly work will alter it"), ["drawback", "hardship", "scholarly", "alter"]);
});

test("the check before a question skips plain words of a sentence choice", async () => {
  await loadFrequencies();
  const q = { skill: "Command of Evidence", stem: [], choices: [choice("The researcher found a scholarly error.")] };
  eq(choiceWords(q, 4.23), ["scholarly"]);
});

test("a choice of Words in Context is asked even if it is plain", async () => {
  await loadFrequencies();
  const q = { skill: "Words in Context", stem: [], choices: [choice("bee"), choice("frog")] };
  eq(choiceWords(q, 4.23), ["bee", "frog"]);
});
