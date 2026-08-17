import { test, expect } from "bun:test";
import { extractJsxTag, findDeadButtons } from "./dead-ui-check.ts";

test("extractJsxTag captures a simple self-closing-style opening tag", () => {
  const source = `<Button variant="solid" tone="primary">Click</Button>`;
  const tag = extractJsxTag(source, 0);
  expect(tag?.raw).toBe(`<Button variant="solid" tone="primary">`);
});

test("extractJsxTag does not truncate at a > inside a JS expression attribute", () => {
  const source = `<Button onClick={() => foo(bar > 5)}>Go</Button>`;
  const tag = extractJsxTag(source, 0);
  expect(tag?.raw).toBe(`<Button onClick={() => foo(bar > 5)}>`);
});

test("extractJsxTag does not truncate at a > inside a quoted string attribute", () => {
  const source = `<Button title="a > b">Go</Button>`;
  const tag = extractJsxTag(source, 0);
  expect(tag?.raw).toBe(`<Button title="a > b">`);
});

// 2026-08-17: root-caused live on fulfillio1 — this is the EXACT source
// shape that shipped with a fully dead "Invite Staff" button (no onClick,
// no href, no explicit type). Regression test using the real original text,
// not a synthetic simplification.
test("flags a Button with no onClick, href, or submit type — the real fulfillio1 shape", () => {
  const source = `
        {currentUserRole === "Owner" && (
          <Button variant="solid" tone="primary" size="md">
            Invite Staff
          </Button>
        )}
`;
  const findings = findDeadButtons("frontend/app/(dashboard)/staff/page.tsx", source);
  expect(findings.length).toBe(1);
  expect(findings[0]!.file).toBe("frontend/app/(dashboard)/staff/page.tsx");
  expect(findings[0]!.issue).toContain("dead UI");
});

test("does not flag the same button once onClick is wired — the real fix shape", () => {
  const source = `
        {currentUserRole === "Owner" && (
          <Button variant="solid" tone="primary" size="md" onClick={() => setInviteOpen(true)}>
            Invite Staff
          </Button>
        )}
`;
  const findings = findDeadButtons("frontend/app/(dashboard)/staff/page.tsx", source);
  expect(findings.length).toBe(0);
});

test("does not flag a Button with an explicit type=\"submit\"", () => {
  const source = `<Button type="submit" isLoading={loading}>Save</Button>`;
  expect(findDeadButtons("x.tsx", source).length).toBe(0);
});

test("does not flag a Button with href (asChild-style link)", () => {
  const source = `<Button asChild href="/dashboard"><Link href="/dashboard">Go</Link></Button>`;
  expect(findDeadButtons("x.tsx", source).length).toBe(0);
});

test("does not flag a bare native <button> with onClick", () => {
  const source = `<button onClick={handleClick}>Go</button>`;
  expect(findDeadButtons("x.tsx", source).length).toBe(0);
});

test("flags multiple dead buttons in the same file, each with its own line number", () => {
  const source = `
<Button>First</Button>
<div>spacer</div>
<Button>Second</Button>
`;
  const findings = findDeadButtons("x.tsx", source);
  expect(findings.length).toBe(2);
  expect(findings[0]!.issue).toContain("line 2");
  expect(findings[1]!.issue).toContain("line 4");
});

test("returns no findings for a file with no Button/button elements at all", () => {
  const source = `export default function Page() { return <div>Hello</div>; }`;
  expect(findDeadButtons("x.tsx", source).length).toBe(0);
});

// 2026-08-17: real false positive found live scanning fulfillio1's own
// vendored button.tsx — a JSDoc comment's PROSE ("...instead of a
// <button>.") contains a literal "<button" substring that isn't real JSX at
// all. Also verifies line numbers stay correct across a multi-line block
// comment (a naive strip-and-collapse would shift every later finding).
test("ignores a <button> mention inside a JSDoc comment, and keeps line numbers accurate afterward", () => {
  const source = `/**
 * Render the single child element (e.g. a Next.js <Link>) with Button's
 * classes/ref instead of a <button>.
 */
export function Component() {
  return <Button>Real dead button</Button>;
}
`;
  const findings = findDeadButtons("x.tsx", source);
  expect(findings.length).toBe(1);
  expect(findings[0]!.issue).toContain("line 6");
});

test("ignores a <button> mention inside a // line comment", () => {
  const source = `// don't forget to style the <button> nicely\nconst x = 1;`;
  expect(findDeadButtons("x.tsx", source).length).toBe(0);
});
