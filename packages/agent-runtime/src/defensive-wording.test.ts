import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";

// 2026-10-23: Google flagged the project's Agent Platform use under its Acceptable Use Policy. The security reviewer's
// instructions said "You attack the code", "show the actual attack", "attack vector, what the attacker gains" and "a
// concrete exploit request" — wording for a defensive code review of the platform's own generated code that reads like
// attack tooling. The reviewer does the same job (OWASP Top 10, same severities, same evidence rules), described as what it
// is: a defensive review that finds weaknesses so they are fixed before delivery.
const files = [
  "../skills/karan.md",
  "../skills/library/security-review/SKILL.md",
  "../skills/navya.md",
  "../../../agents/qa/karan/src/index.ts",
  "../../../agents/tilotma/src/tools.ts",
];
const banned = [/you attack the code/i, /show the actual attack/i, /attack vector/i, /what the attacker gains/i, /exploit request/i, /exploitable/i, /agents attack/i];

for (const f of files) {
  test(`${f} describes a defensive review, not an attack`, () => {
    const src = readFileSync(new URL(f, import.meta.url), "utf-8")
      // code comments are not sent to any model
      .split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
    for (const re of banned) expect({ f, phrase: String(re), found: re.test(src) }).toEqual({ f, phrase: String(re), found: false });
  });
}

test("the security reviewer still checks the same categories with the same severities", () => {
  const k = readFileSync(new URL("../skills/karan.md", import.meta.url), "utf-8");
  for (const s of ["OWASP Top 10", "CRITICAL (score -20): SQL injection, auth bypass, exposed secrets, RCE.", "HIGH (score -10)", "file, line"]) expect(k).toContain(s);
});
