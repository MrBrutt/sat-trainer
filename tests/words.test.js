import { test, eq } from "./run.js";
import { hardWordsIn, choiceWords, loadFrequencies, DERIVED } from "../assets/words.js";
import { OBVIOUS } from "../assets/obvious-words.js";

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
  eq(await hard("moss-laden branches"), ["moss", "laden"]);
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
  eq(await hard("Seneca weaver Marie Watt and musings on tenth-century life"), ["weaver", "musing"]);
});

test("a rare plural in -uses comes back to its word", async () => {
  eq(await hard("the octopuses"), ["octopus"]);
});

test("an international word a Russian speaker reads at sight is no card", async () => {
  eq(await hard("the automation of the archive"), []);
});

test("false friends of a Russian speaker stay cards", () => {
  const FALSE = ["accurate", "accurately", "sympathetic", "sympathy", "fabric", "decade", "concrete", "conductor", "anecdote",
    "speculate", "speculative", "utilize", "occupation", "prospect", "sophisticated", "silicon", "sensation", "render",
    "dramatically", "diverse", "obligation", "translate", "personage", "palm", "temperamental", "observe", "qualify", "vocal"];
  eq(FALSE.filter((w) => OBVIOUS.has(w)), []);
});

test("a word made from another card's word is learned on that card", async () => {
  await loadFrequencies();
  const hs = hardWordsIn("The loss is not attributable to the attribute of ice.", 4.23);
  eq(hs.map((h) => [h.key, h.form]), [["attribute", "attributable"]]);
});

test("several forms of one word are learned on its card", async () => {
  eq(await hard("with precision, precisely and vigorously"), ["precise", "vigor"]);
});

test("a Words in Context choice keeps its exact form: no family moves it to a base word", () => {
  eq(["predatory", "probability", "situated", "discernible"].filter((w) => DERIVED[w]), []);
});

test("a family whose meanings part stays two cards", async () => {
  eq(await hard("a high elevation; to elevate the mood"), ["elevation", "elevate"]);
});

test("narrow science terms are no cards: the passage needs them, the SAT does not", async () => {
  eq(await hard("ocean acidification harms pteropods and their periostracum"), []);
});

test("a word the passage explains in parentheses is no card there", async () => {
  eq(await hard("They saw cygnets (young birds) near a woman in a huipil (a long shirt)."), []);
});

test("a word explained between two dashes, or after «known as», is no card there", async () => {
  eq(await hard("White dwarfs—small, heavy stars—cool slowly. It is a feeling known as nostalgia."), []);
});

test("«that is» after a word explains it", async () => {
  eq(await hard("The rocks are undifferentiated—that is, they never changed."), []);
});

test("an aside or a Latin name in parentheses explains nothing", async () => {
  eq(await hard("Their merits (as is often the case) grew; the black swan (Cygnus atratus) lives here."), ["merit", "swan"]);
});

test("units, examples and qualifiers in parentheses explain nothing", async () => {
  eq(await hard("distance from the cave (meters); endurance (e.g., their pace); curves (rather than angles); the legislature (the Storting)"),
    ["cave", "endure", "curve", "legislature"]);
});

test("a word explained in one place is still a card where it is not", async () => {
  eq(await hard("Cygnets (young birds) went out. Later the cygnets grew."), ["cygnet"]);
});

test("an adverb is learned on its adjective's card, also when that came from a choice", async () => {
  eq(await hard("It inevitably happened, substantially and exclusively."), ["inevitable", "substantial", "exclusive"]);
});

test("real vocabulary stays, even when built from common parts", async () => {
  eq(await hard("the drawback and hardship of scholarly work will alter it"), ["drawback", "hardship", "scholar", "alter"]);   // scholarly is learned on scholar
});

test("the check before a question skips plain words of a sentence choice", async () => {
  await loadFrequencies();
  const q = { skill: "Command of Evidence", stem: [], choices: [choice("The researcher found a scholarly error.")] };
  eq(choiceWords(q, 4.23), ["scholar"]);
});

test("a choice of Words in Context is asked even if it is plain", async () => {
  await loadFrequencies();
  const q = { skill: "Words in Context", stem: [], choices: [choice("bee"), choice("frog")] };
  eq(choiceWords(q, 4.23), ["bee", "frog"]);
});
