// What a customer may see. Agent names, the number of agents and how the system is built never appear in anything a
// customer sees (CLAUDE.md confidentiality rule; Amit, 2026-10-29: a question to the customer reads like a normal chat
// message). The model that writes customer text is told the same; this is the check and the rewrite behind it.

// The full roster (CLAUDE.md), plus the front-door assistant. Matched as whole, capitalised words.
const AGENT_NAMES = [
  "Tilotma", "Saanvi", "Arjun", "Vanya", "Aanya", "Shubham", "Pranav", "Aarav", "Riya", "Navya", "Karan", "Deepika",
  "Kabir", "Sayan", "Dhruv", "Aryan", "Ishaan", "Ishan", "Naina", "Sid", "Neha", "Vikram", "Priya", "Raj", "Surya",
  "Ananya", "Kunal", "Divya", "Rohan", "Prerna", "Neel", "Tanya", "Aman", "Mihir", "Kavya", "Ria", "Dev", "Pooja",
  "Manan", "Shriya", "Radhika", "Maya",
];

// Internal roles and parts, each with the plain words a customer sees instead. Longest first.
const INTERNAL_WORDS: Array<[RegExp, string]> = [
  [/\b(?:the\s+)?(?:agents?|builders?)\s+(?:in|of|on)\s+the\s+(?:pipeline|workflow|system)\b/gi, "we"],
  [/\b(?:the\s+)?(?:frontend|backend|database|db)\s+builders?\b/gi, "we"],
  [/\b(?:the\s+)?chief[\s-]ai\b/gi, "we"],
  [/\b(?:the\s+)?(?:reviewers?|checkers?|qa\s+agents?)\b/gi, "our checks"],
  [/\b(?:the\s+)?(?:sub-?agents?|agents?|builders?|orchestrator)\b/gi, "we"],
  [/\b(?:the\s+)?(?:pipeline|workflow)\b/gi, "the build"],
  [/\b(?:gemini|claude|nim|temporal|ollama|qwen|deepseek|kimi)\b[\w.-]*/gi, "we"],
];

// "Shubham needs" becomes "we needs": the verbs a question uses go back to the form that fits "we".
const WE_VERBS: Record<string, string> = { needs: "need", wants: "want", has: "have", is: "are", was: "were", asks: "ask", requires: "require", uses: "use", knows: "know", could: "could" };

const NAME = new RegExp(`\\b(?:${AGENT_NAMES.join("|")})\\b`, "g");

/** Every internal name or word in the text, as written. */
export function internalTermsIn(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(NAME)) found.add(m[0]);
  for (const [re] of INTERNAL_WORDS) for (const m of text.matchAll(new RegExp(re.source, re.flags))) found.add(m[0].replace(/^the\s+/i, ""));
  return [...found];
}

/** The text with every internal name and word replaced by plain words. Text without any is returned unchanged. */
export function toCustomerText(text: string): string {
  if (internalTermsIn(text).length === 0) return text;
  let out = text.replace(NAME, "we");
  for (const [re, plain] of INTERNAL_WORDS) out = out.replace(new RegExp(re.source, re.flags), plain);
  out = out
    .replace(/\b(we)(?:\s*(?:,|and)\s*we\b)+,?/gi, "$1")
    .replace(/\bwe\s+we\b/gi, "we")
    .replace(/\b(we),\s+(?=(?:needs|wants|has|is|was|asks|requires|uses|knows|could)\b)/gi, "$1 ")
    .replace(/\b(we)\s+(\w+)\b/gi, (m, we: string, verb: string) => (WE_VERBS[verb.toLowerCase()] ? `${we} ${WE_VERBS[verb.toLowerCase()]}` : m))
    .replace(/\(\s*\)/g, "")
    .replace(/\s+([,.;:!?)])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
  return out.charAt(0).toUpperCase() + out.slice(1);
}
