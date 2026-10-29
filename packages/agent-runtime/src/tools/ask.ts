// ask_question — a builder that needs a value asks instead of guessing (2026-10-29, team plan stage 2). The Chief AI answers
// from the approved request and spec, with a quote that must really be there; when they do not answer it, the question
// goes to the customer as a plain chat message (no agent names — CLAUDE.md confidentiality) and the build waits for the
// answer. Every answer is kept in <build>/build-answers.jsonl, which every builder and reviewer reads.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { NimToolDef } from "@nexsidi/llm-client";
import type { ToolResult } from "./file.ts";
import { buildDirFor } from "../build-dir.ts";
import { toCustomerText } from "../customer-text.ts";

export interface BuildAnswer {
  question: string;
  answer: string;
  source: "spec" | "customer";
  quote?: string;
  askedBy: string;
  at: string;
}

export interface CustomerQuestion {
  id: string;
  question: string;
  forCustomer: string;
  askedBy: string;
  at: string;
  status: "open" | "answered";
  answer?: string;
}

export type DocumentAnswerer = (input: { question: string; why: string; documents: string }) => Promise<{ answer?: string; quote?: string; forCustomer?: string }>;

const answersFile = (projectId: string) => join(buildDirFor(projectId), "build-answers.jsonl");
const questionsFile = (projectId: string) => join(buildDirFor(projectId), "customer-questions.jsonl");

function readLines<T>(file: string): T[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf-8")
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((l) => {
      try {
        return [JSON.parse(l) as T];
      } catch {
        return [];
      }
    });
}

function append(file: string, record: object): void {
  mkdirSync(join(file, ".."), { recursive: true });
  appendFileSync(file, JSON.stringify(record) + "\n");
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

// The same question in other words is one question: "What are the store's opening hours for each day?" and "Store opening
// hours?" (Brewline 3 proof) — the customer is never asked twice. Key words only; small words do not count.
const SMALL_WORDS = new Set(
  "what which when where who whom how many much is are was were be been do does did the a an for each every day days of our your their its it this that these those to in on at per by with there any some can could will would should we you they i me my please tell us about".split(" "),
);
function keyWords(q: string): Set<string> {
  return new Set(q.toLowerCase().replace(/'s\b/g, "").replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w.length > 1 && !SMALL_WORDS.has(w)));
}
export function sameQuestion(a: string, b: string): boolean {
  const A = keyWords(a);
  const B = keyWords(b);
  if (A.size === 0 || B.size === 0) return squash(a.toLowerCase()) === squash(b.toLowerCase());
  const [small, big] = A.size <= B.size ? [A, B] : [B, A];
  let hit = 0;
  for (const w of small) if (big.has(w)) hit++;
  return hit / small.size >= 0.8 && hit >= Math.min(2, small.size);
}

export function readAnswers(projectId: string): BuildAnswer[] {
  return readLines<BuildAnswer>(answersFile(projectId));
}

/** Questions to the customer still waiting for an answer (the last record of each question counts). */
export function openCustomerQuestions(projectId: string): CustomerQuestion[] {
  const last = new Map<string, CustomerQuestion>();
  for (const q of readLines<CustomerQuestion>(questionsFile(projectId))) last.set(q.id, q);
  return [...last.values()].filter((q) => q.status === "open");
}

/** The customer's answer: closes the question and becomes an answer every agent reads. */
export function recordCustomerAnswer(projectId: string, id: string, answer: string): void {
  const q = openCustomerQuestions(projectId).find((x) => x.id === id);
  if (!q) return;
  const at = new Date().toISOString();
  append(questionsFile(projectId), { ...q, status: "answered", answer, at });
  append(answersFile(projectId), { question: q.question, answer, source: "customer", askedBy: q.askedBy, at } satisfies BuildAnswer);
}

/** The answers as a section of an agent's task, or "" when there are none. */
export function answersSection(projectId: string): string {
  const answers = readAnswers(projectId);
  if (answers.length === 0) return "";
  return [
    "ANSWERS GIVEN DURING THE BUILD (use these values exactly, in the frontend and the backend alike):",
    ...answers.map((a) => `- ${a.question} → ${a.answer}${a.source === "customer" ? " (the customer's answer)" : ""}`),
  ].join("\n");
}

function documentsFor(projectId: string): string {
  const dir = buildDirFor(projectId);
  const read = (f: string) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), "utf-8") : "");
  return [
    `THE CUSTOMER'S REQUEST:\n${read("user-request.txt")}`,
    `THE APPROVED SPEC:\n${read("spec.json")}`,
    answersSection(projectId),
  ]
    .filter((s) => s.trim())
    .join("\n\n")
    .slice(0, 80_000);
}

const ANSWERER_PROMPT = `You are Tilotma. A builder asks a question about the app it is building. Answer ONLY from the documents below.
Reply with JSON only:
- If the documents answer it: {"answer": "<the answer>", "quote": "<the exact text from the documents that says so, copied word for word>"}
- If they do not: {"forCustomer": "<the question as you would ask the customer in a chat: plain words, one or two sentences, offer common choices if that helps>"}
The customer must never see how the app is built: in forCustomer never mention agents, builders, reviewers, AI, tools, models or names.`;

const defaultAnswerer: DocumentAnswerer = async ({ question, why, documents }) => {
  const { routeWithFallback, withCallContext } = await import("@nexsidi/llm-client");
  const r = await withCallContext({ agent: "chief-ai", tier: "critical" }, () =>
    routeWithFallback("critical", [{ role: "user", content: `${ANSWERER_PROMPT}\n\nQUESTION: ${question}\nWHY THE BUILDER NEEDS IT: ${why}\n\n${documents}` }], { maxTokens: 2_000 }),
  );
  const json = r.content.match(/\{[\s\S]*\}/)?.[0];
  try {
    return json ? (JSON.parse(json) as { answer?: string; quote?: string; forCustomer?: string }) : {};
  } catch {
    return {};
  }
};

export async function execAskQuestion(
  projectId: string | undefined,
  agentName: string,
  args: { question?: string; why?: string },
  answerer: DocumentAnswerer = defaultAnswerer,
): Promise<ToolResult> {
  const question = String(args.question ?? "").trim();
  const why = String(args.why ?? "").trim();
  if (!projectId) return { status: "error", summary: "ask_question needs a project." };
  if (!question || !why) return { status: "error", summary: "Give the question and why your work needs the answer." };

  const known = readAnswers(projectId).find((a) => sameQuestion(a.question, question));
  if (known) return { status: "success", summary: `Already answered: ${known.answer}. Use exactly this value.` };
  if (openCustomerQuestions(projectId).some((q) => sameQuestion(q.question, question))) {
    return { status: "success", summary: "This question has already gone to the customer. Do not guess a value; finish the work that does not depend on it." };
  }

  const documents = documentsFor(projectId);
  let reply: { answer?: string; quote?: string; forCustomer?: string } = {};
  try {
    reply = await answerer({ question, why, documents });
  } catch (err) {
    console.error(`[ask] the answer from the documents failed, the question goes to the customer: ${String(err).slice(0, 160)}`);
  }
  const quote = squash(reply.quote ?? "");
  if (reply.answer?.trim() && quote.length >= 8 && squash(documents).includes(quote)) {
    append(answersFile(projectId), { question, answer: reply.answer.trim(), source: "spec", quote, askedBy: agentName, at: new Date().toISOString() } satisfies BuildAnswer);
    return { status: "success", summary: `Answer from the approved request and spec: ${reply.answer.trim()} It says: "${quote}". Use exactly this value.` };
  }

  const record: CustomerQuestion = {
    id: randomUUID(),
    question,
    forCustomer: toCustomerText(reply.forCustomer?.trim() || question),
    askedBy: agentName,
    at: new Date().toISOString(),
    status: "open",
  };
  append(questionsFile(projectId), record);
  console.log(`[ask] ${agentName} asked a question the documents do not answer; it goes to the customer: ${record.forCustomer}`);
  return {
    status: "success",
    summary: "The approved request and spec do not answer this, so it has gone to the customer. Do not guess a value. Finish the work that does not depend on it; the build waits for the customer's answer and you will get it before you go on.",
  };
}

export const ASK_QUESTION_TOOL_DEF: NimToolDef = {
  type: "function",
  function: {
    name: "ask_question",
    description:
      "Ask for a fact your work needs that the task does not give (an opening time, a limit, a price, a rule). It is answered from the approved request and spec, or asked of the customer. Never guess such a value.",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "The question, in one sentence" },
        why: { type: "string", description: "What you are building that needs the answer" },
      },
      required: ["question", "why"],
    },
  },
};

/** The answers as a paragraph to append to a task, or "" when there are none. */
export function answersBlock(projectId: string): string {
  const section = answersSection(projectId);
  return section ? `\n\n${section}` : "";
}
