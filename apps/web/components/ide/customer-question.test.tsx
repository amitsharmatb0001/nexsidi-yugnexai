import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { CustomerQuestion } from "./IdeWorkspace";

// 2026-10-29 (Amit, team plan stage 2): a question for the customer during a build looks like a chat message — the
// question as the assistant's line, a box to answer, Send. No agent names, no internal words (CLAUDE.md confidentiality);
// the text arrives already in the customer's words from the API.
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

test("the question is shown as a chat message with a box to answer and a Send button", () => {
  const html = renderToStaticMarkup(<CustomerQuestion text="What are your store's opening hours?" sending={false} onAnswer={() => {}} />);
  expect(text(html)).toContain("What are your store's opening hours?");
  expect(html).toContain('aria-label="Your answer"');
  expect(text(html)).toContain("Send");
});

test("while the answer is sent, the box and the button wait", () => {
  const html = renderToStaticMarkup(<CustomerQuestion text="What are your store's opening hours?" sending onAnswer={() => {}} />);
  expect(text(html)).toContain("Sending");
  expect(html).toContain("disabled");
});

test("the build page shows the waiting question and sends the answer to the build", () => {
  const page = readFileSync(new URL("../../app/build/[id]/page.tsx", import.meta.url), "utf-8");
  expect(page).toContain('ev.type === "question"');
  expect(page).toContain("/question`");
  expect(page).toContain("/answer`");
  expect(page).toContain("customerQuestion={");
});
