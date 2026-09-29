import { test, expect } from "bun:test";
import { assembleSystemPrompt } from "./prompt-assembly.ts";

// 2026-09-28: real, recurring waste (Cardwise, Plantly). Aanya's skill said
// NexUI's <Button> "does NOT submit forms — always add onClick={handleSubmit}".
// That was stale: today's vendored NexUI Button renders a native <button> and
// passes `type` through, so type="submit" submits the form. Following the rule
// made every form run its handler twice, and Navya flagged exactly that as a
// HIGH finding on every build — a guaranteed extra fix round.
test("Aanya is told to submit forms with type=\"submit\", never an extra onClick={handleSubmit}", () => {
  const prompt = assembleSystemPrompt({ agentName: "aanya", basePrompt: "" });
  expect(prompt).not.toMatch(/always add `?onClick=\{handleSubmit\}/i);
  expect(prompt).not.toMatch(/do NOT submit (parent )?forms/i);
  expect(prompt).toContain('type="submit"');
});
