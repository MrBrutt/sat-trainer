// The trainer's dictionary (assets/data/defs.txt) is for a learner of English: a meaning is put in
// words more common than the word itself, and every word has a short example of its own, so a card
// does not lean on a hard sentence from a question.
import { test, eq } from "./run.js";

const text = (path) => fetch(new URL(path, import.meta.url)).then((r) => r.text());

const rows = (await text("../assets/data/defs.txt")).split("\n")
  .filter((l) => l && l[0] !== "#").map((l) => { const [key, pos, def, example = ""] = l.split("|"); return { key, pos, def, example }; });

const freq = new Map();
for (const line of (await text("../assets/data/en-zipf.txt")).split("\n")) {
  if (!line || line[0] === "#") continue;
  const [band, ...ws] = line.split(" ");
  for (const w of ws) if (w && !freq.has(w)) freq.set(w, Number(band) / 10);
}
const ENDINGS = [["ies", "y"], ["ied", "y"], ["ing", ""], ["ing", "e"], ["ed", ""], ["ed", "e"], ["d", ""], ["es", ""], ["s", ""], ["ly", ""], ["ness", ""], ["ment", ""], ["er", ""], ["est", ""]];
const zipf = (w) => Math.max(freq.get(w) || 0, ...ENDINGS.filter(([e]) => w.endsWith(e)).map(([e, add]) => freq.get(w.slice(0, -e.length) + add) || 0));

const RARE = 3.5;
// Rarer than RARE in the list, but plain to a learner: built from common parts, or a school word.
const PLAIN = new Set(`believable decorate untrue angrily unimportant sunflower unwelcome vowel tofu seaweed equator
  phosphorus reindeer mammoths neutrons mammal madagascar handwritten blouse rainforest reptile undamaged spleen aback
  tilapia chatter colorless unreliable predicts announces publicly dishonest disagreeing unfriendly unsteady
  furry beak monkeys snail clam mozambique saltwater`.split(/\s+/).filter(Boolean));
// "(past of surmise)", "past participle of draw": the note names the base form, it is not the meaning
const NOTE = /\((?:past|form|plural|past participle) of [^)]*\)|past participle of \w+|plural of \w+|british spelling of \w+/gi;
// "threw up = produced", "lucid dream = a dream in which…": the phrase before "=" is what is explained
const meaning = (def) => def.replace(NOTE, " ").replace(/(^|;|\))[^;=)]*=/g, "$1");
const own = (w, key) => key.split(/[\s-]+/).some((k) => k.slice(0, 5) === w.slice(0, 5));

// Phrasal verbs ("put out", "take back") mean what their parts do not say.
const PHRASAL = new RegExp(String.raw`\b(?:put|give|gave|take|took|carry|carries|carried|bring|brought|turn|get|got|break|broke|come|came|go|goes|went|hold|held|keep|kept|look|pick|point|call|cut|fall|fell|figure|hand|pass|passed|pull|rule|sort|stand|stood|throw|threw|wipe|wear|wore|lay|laid|laying|draw|drew|blow|shut|sum|stir|single|spell|spread|tear|set|make|made|run|ran|work|die|dying|find|found|show|back|cutting|putting|getting|setting|running|shutting|stirring)(?:s|ing)?\s+(?:out|up|off|down|over|away|aside|forth|apart|back|about)\b`, "i");

test("meanings are put in words a learner knows", () => {
  const hard = [];
  for (const r of rows) {
    const words = meaning(r.def).toLowerCase().match(/[a-z]+/g) || [];
    const rare = words.filter((w) => w.length > 3 && zipf(w) < RARE && !PLAIN.has(w) && !own(w, r.key));
    if (rare.length) hard.push(`${r.key}: ${rare.join(", ")}`);
  }
  eq(hard, []);
});

test("meanings have no phrasal verbs", () => {
  eq(rows.filter((r) => PHRASAL.test(meaning(r.def))).map((r) => `${r.key}: ${meaning(r.def).match(PHRASAL)[0]}`), []);
});

test("every word has a short example of its own, with the word in it", () => {
  // "deny" → "denied", "hide" → "hid": the stem leaves out a last y or e
  const stem = (k) => k.split(/[\s-]+/)[0].toLowerCase().replace(/[ye]$/, "").slice(0, 4);
  const bad = rows.filter((r) => !r.example || r.example.length > 120 || !r.example.toLowerCase().includes(stem(r.key)));
  eq(bad.map((r) => r.key), []);
});
