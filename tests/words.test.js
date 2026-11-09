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
