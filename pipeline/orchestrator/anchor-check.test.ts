import { test, expect } from "bun:test";
import { findDanglingAnchors, findDanglingAnchorsInApp } from "./anchor-check.ts";

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

// 2026-10-13 (Shopbill run 9): the removed comparison section's file was still in the folder, unused, and its id
// made the hero's "#comparison" link look valid. Only files the app actually renders count.
test("a link whose only target is in a file nothing imports is still dead", () => {
  const files = [
    { path: "app/page.tsx", content: 'import { Hero } from "@/components/marketing/Hero";\nexport default function P() { return <Hero />; }' },
    { path: "components/marketing/Hero.tsx", content: '<a href="#comparison">Compare</a>' },
    { path: "components/marketing/ComparisonSection.tsx", content: '<section id="comparison">...</section>' },
  ];
  expect(findDanglingAnchorsInApp(files)).toEqual([{ anchor: "comparison", file: "components/marketing/Hero.tsx" }]);
});

test("a link whose target is in a component the page renders (through nested imports) is fine", () => {
  const files = [
    { path: "app/page.tsx", content: 'import { Hero } from "@/components/marketing/Hero";\nimport { Workflow } from "../components/marketing/Workflow";' },
    { path: "components/marketing/Hero.tsx", content: '<a href="#workflow">See how</a>' },
    { path: "components/marketing/Workflow.tsx", content: 'import { Step } from "./Step";\n<section id="workflow"><Step /></section>' },
    { path: "components/marketing/Step.tsx", content: "export function Step() { return null; }" },
  ];
  expect(findDanglingAnchorsInApp(files)).toEqual([]);
});

test("an unused component's own dead links are not reported — nobody can click them", () => {
  const files = [
    { path: "app/page.tsx", content: "export default function P() { return null; }" },
    { path: "components/Old.tsx", content: '<a href="#gone">x</a>' },
  ];
  expect(findDanglingAnchorsInApp(files)).toEqual([]);
});
