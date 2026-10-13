import { test, expect } from "bun:test";
import { findDanglingAnchors } from "./anchor-check.ts";

// 2026-10-13 (Shopbill run 5): the comparison section was removed and the hero kept a "Compare vs Spreadsheets"
// button pointing at #comparison — a link to nowhere.

test("an in-page link to a section that no longer exists is reported", () => {
  const files = [
    { path: "components/marketing/Hero.tsx", content: '<a href="#comparison">Compare vs Spreadsheets</a>' },
    { path: "app/page.tsx", content: "<Hero /><WorkflowSection />" },
  ];
  expect(findDanglingAnchors(files)).toEqual([{ anchor: "comparison", file: "components/marketing/Hero.tsx" }]);
});

test("a link whose target id exists anywhere in the app is fine", () => {
  const files = [
    { path: "components/marketing/Hero.tsx", content: '<a href="#workflow">See how</a>' },
    { path: "components/marketing/WorkflowSection.tsx", content: '<section id="workflow">...</section>' },
  ];
  expect(findDanglingAnchors(files)).toEqual([]);
});

test("ids written as an object property or a template are found too", () => {
  const files = [
    { path: "a.tsx", content: '<a href="#pricing">p</a><a href={"#faq"}>f</a>' },
    { path: "b.tsx", content: "<Section id={'pricing'} /><div {...{ id: \"faq\" }} />" },
  ];
  expect(findDanglingAnchors(files)).toEqual([]);
});

test("a bare # link and a link to the top are not reported", () => {
  expect(findDanglingAnchors([{ path: "a.tsx", content: '<a href="#">x</a><a href="#top">t</a>' }])).toEqual([]);
});
