// The four Reading and Writing blocks of the SAT and their skills, named as College Board's Question
// Bank names them. All four are always on show; a skill from elsewhere (Math, a new name) is kept
// reachable: under its own block when the PDF names one, in a group of its own otherwise.
export const DOMAINS = [
  { name: "Craft and Structure", skills: ["Words in Context", "Text Structure and Purpose", "Cross-Text Connections"] },
  { name: "Information and Ideas", skills: ["Central Ideas and Details", "Command of Evidence", "Inferences"] },
  { name: "Standard English Conventions", skills: ["Boundaries", "Form, Structure, and Sense"] },
  { name: "Expression of Ideas", skills: ["Rhetorical Synthesis", "Transitions"] },
];

const OTHER = "Другое";
const low = (s) => (s || "").trim().toLowerCase();

// A skill's name as DOMAINS writes it. Exports may say "Command of Evidence: Quantitative".
export function skillName(skill) {
  const key = low(skill).startsWith("command of evidence") ? "command of evidence" : low(skill);
  return DOMAINS.flatMap((d) => d.skills).find((s) => low(s) === key) || skill;
}

// One colour per skill, the same on every device: the ones the student's Mac showed on 2026-11-16.
// (Devices used to hand colours out in the order skills reached them, so the phone's differed.)
const SKILL_COLORS = {
  "Central Ideas and Details": "#f59e0b", "Command of Evidence": "#ec4899", "Inferences": "#22c55e",
  "Words in Context": "#3b82f6", "Text Structure and Purpose": "#14b8a6", "Cross-Text Connections": "#8b5cf6",
  "Rhetorical Synthesis": "#a855f7", "Transitions": "#84cc16",
  "Boundaries": "#ef4444", "Form, Structure, and Sense": "#0ea5e9",
};
export const skillColor = (skill) => SKILL_COLORS[skillName(skill)] || null;

export function domainOf(q) {
  const skill = skillName(q.skill);
  return DOMAINS.find((d) => d.skills.includes(skill))?.name
    || DOMAINS.find((d) => low(d.name) === low(q.domain))?.name
    || q.domain || OTHER;
}

// Is a question within the chosen block and skill ("all" or nothing: any)?
export function inFocus(q, domain, skill) {
  if (domain && domain !== "all" && domainOf(q) !== domain) return false;
  return !skill || skill === "all" || skillName(q.skill) === skillName(skill);
}

const tally = (name) => ({ name, count: 0, done: 0, ok: 0 });
const add = (row, p) => { row.count++; if (p) row.done++; if (p?.ok) row.ok++; };

// Blocks with their skills and how far the student is: [{name, count, done, ok, skills: [{name, count, done, ok}]}].
export function outline(questions, progress) {
  const blocks = new Map(DOMAINS.map((d) => [d.name, { ...tally(d.name), skills: d.skills.map(tally) }]));
  for (const q of questions) {
    const name = domainOf(q);
    if (!blocks.has(name)) blocks.set(name, { ...tally(name), skills: [] });
    const block = blocks.get(name);
    const skill = skillName(q.skill);
    let row = block.skills.find((s) => s.name === skill);
    if (!row) block.skills.push(row = tally(skill));
    add(block, progress[q.id]);
    add(row, progress[q.id]);
  }
  return [...blocks.values()];
}
