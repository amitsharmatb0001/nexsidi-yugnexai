import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkFindingProof, buildProofContext, dropUnprovenFindings } from "./finding-proof.ts";

// 2026-10-24 (Brewline root cause, docs/root-cause/2026-10-24-brewline.md): in the last live round 4 of 5 findings were
// false — the checker quoted code that is not in the project, cited files that do not exist and endpoints that are not
// in the approved contract — and each still cost a paid fix round, because the live stage checked nothing. The fixtures
// are the recorded finding texts and the exact code each round reviewed (from the build's own git snapshots): round 10
// (five real findings) and round 11 (four false, one with false details).
const FIX = join(import.meta.dir, "__fixtures__", "finding-proof");
const findings = JSON.parse(readFileSync(join(FIX, "findings.json"), "utf-8")) as { r10: string[]; r11: string[] };

test("round 10: the four findings that quote real code are kept; the one that misquotes the header is flagged", () => {
  const ctx = buildProofContext(join(FIX, "r10"));
  for (const f of findings.r10) {
    const r = checkFindingProof(f, ctx);
    // Checked by hand against the snapshot: Header.tsx uses `document.cookie.includes("token=")` and does decode the
    // token; the quoted `cookies.some((c) => c.startswith("token="))` is in no file. Its 401 half is true, which is why a
    // flagged finding goes to the Chief AI check with the real code instead of being thrown away.
    if (f.includes("unvalidated cookie check")) expect(r).toEqual({ ok: false, reason: expect.stringContaining("cookies.some") });
    else expect({ f: f.slice(0, 60), r }).toEqual({ f: f.slice(0, 60), r: { ok: true } });
  }
});

test("the false findings of round 10's successor are dropped, each with the reason", () => {
  const ctx = buildProofContext(join(FIX, "r11"));
  const results = findings.r11.map((f) => ({ f, r: checkFindingProof(f, ctx) }));
  const byTopic = (word: string) => results.find((x) => x.f.includes(word))!.r;
  expect(byTopic("footer logo")).toEqual({ ok: false, reason: expect.stringContaining("yugnex-logo.png") });
  expect(byTopic("rate limiting")).toEqual({ ok: false, reason: expect.stringContaining("/api/auth/login") });
  expect(byTopic("cors")).toEqual({ ok: false, reason: expect.stringContaining("app.use(cors());") });
  expect(byTopic("forward-only")).toEqual({ ok: false, reason: expect.any(String) });
  // The duplicate-menu finding names an endpoint that does not exist and a seed file that does not exist.
  expect(byTopic("duplicate menu")).toEqual({ ok: false, reason: expect.any(String) });
});

test("a finding with no checkable claim is kept — only proof of falsehood drops one", () => {
  const ctx = buildProofContext(join(FIX, "r11"));
  expect(checkFindingProof("the menu page looks crowded on a phone (screenshot recheck-menu.png)", ctx)).toEqual({ ok: true });
  expect(checkFindingProof("frontend/lib/api.ts does not clear the cookie on 401: it should call `window.location.assign(\"/sign-in\")`", ctx)).toEqual({ ok: true });
});

test("an endpoint outside the contract is kept when the app's own frontend calls it (a real broken call)", () => {
  const ctx = buildProofContext(join(FIX, "r11"));
  ctx.frontendSource += "\nfetch(`${API}/api/v1/loyalty`)";
  expect(checkFindingProof("get /api/v1/loyalty returns 404 when the menu page loads", ctx)).toEqual({ ok: true });
  expect(checkFindingProof("get /api/v1/loyalty is missing", { ...ctx, frontendSource: "" })).toEqual({ ok: false, reason: expect.stringContaining("/api/v1/loyalty") });
});

test("structured findings are filtered on their file and text together", () => {
  const out = dropUnprovenFindings(
    [
      { file: "backend/src/routes/auth.ts", issue: "no rate limit on POST /api/auth/login" },
      { file: "frontend/components/layout/Footer.tsx", issue: "footer has no aria-label on the logo link" },
    ],
    join(FIX, "r11"),
  );
  expect(out.kept.map((f) => f.file)).toEqual(["frontend/components/layout/Footer.tsx"]);
  expect(out.dropped[0]!.reason).toContain("/api/auth/login");
});
