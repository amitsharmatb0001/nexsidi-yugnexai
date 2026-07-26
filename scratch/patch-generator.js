const fs = require("fs");
const path = require("path");

const targetFile = path.resolve(__dirname, "../agents/generators/aanya/src/index.ts");
console.log("Reading file:", targetFile);
let content = fs.readFileSync(targetFile, "utf-8");

// Normalize line endings to LF (\n)
content = content.replace(/\r\n/g, "\n");

// 1. Patch the system prompt FILES YOU MUST WRITE block
const targetPrompt = `FILES YOU MUST WRITE:
- app/page.tsx (landing / sign-in redirect)
- app/sign-in/page.tsx
- app/sign-up/page.tsx
- app/dashboard/page.tsx (main authenticated view)
- Any additional pages, components, hooks needed for the feature set`;

const replacementPrompt = `FILES YOU MUST WRITE:
You MUST create all pages, routes, and components listed in the "PLANNED FRONTEND FILES AND PAGES" section of your task description. Typically this includes:
- app/page.tsx (landing / sign-in redirect)
- Dedicated routing files for each planned page (e.g., app/about/page.tsx, app/services/page.tsx, app/contact/page.tsx, app/dashboard/page.tsx)
- Do NOT consolidate separate public pages (about, services, contact) into dashboard tabs unless the plan explicitly requests it. Create separate dedicated file routes for them.`;

if (content.includes(targetPrompt)) {
  content = content.replace(targetPrompt, replacementPrompt);
  console.log("System prompt patched successfully.");
} else {
  console.error("Target prompt NOT found!");
}

// 2. Patch the buildAgentTask function to append plan.aanyaTasks
const targetTask = `  return \`\${goal}

PROJECT: \${plan.appName ?? "web app"}
DESCRIPTION: \${plan.appDescription ?? ""}

IMPORTANT — do not confuse these two unrelated things:
- Each endpoint's "route" below (e.g. "/api/v1/notes") is a BACKEND API ROUTE. It is reference-only context — never pass it as write_file's "path" argument.
- write_file's "path" argument is always a FRONTEND FILE PATH relative to the project root (e.g. "app/notes/page.tsx", "app/dashboard/page.tsx"). Every write_file call must use a distinct file path — never reuse the same path for two different pieces of content.

\${apiSection}

SHARED TYPES (use these exact field names in your TypeScript interfaces):
\${plan.sharedTypes ?? ""}

USER STORY:
A user should be able to sign up, log in, and then use all the core features.
The app should look polished and professional using NexSidi UI components.
No AI-generated "purple gradients over white cards" — use the dark void theme.

Start with list_files to see the scaffold, then write pages and components.\`;`;

const replacementTask = `  const taskDetails = (plan.aanyaTasks || []).map((t, idx) => {
    return \`Task \${idx + 1}: \${t.description}\\nFiles to write:\\n\${t.outputFiles.map(f => \`- \${f}\`).join("\\n")}\`;
  }).join("\\n\\n");

  return \`\${goal}

PROJECT: \${plan.appName ?? "web app"}
DESCRIPTION: \${plan.appDescription ?? ""}

IMPORTANT — do not confuse these two unrelated things:
- Each endpoint's "route" below (e.g. "/api/v1/notes") is a BACKEND API ROUTE. It is reference-only context — never pass it as write_file's "path" argument.
- write_file's "path" argument is always a FRONTEND FILE PATH relative to the project root (e.g. "app/notes/page.tsx", "app/dashboard/page.tsx"). Every write_file call must use a distinct file path — never reuse the same path for two different pieces of content.

\${apiSection}

SHARED TYPES (use these exact field names in your TypeScript interfaces):
\${plan.sharedTypes ?? ""}

USER STORY:
A user should be able to sign up, log in, and then use all the core features.
The app should look polished and professional using NexSidi UI components.
No AI-generated "purple gradients over white cards" — use the dark void theme.

PLANNED FRONTEND FILES AND PAGES (you MUST implement these pages and files as planned):
\${taskDetails}

Start with list_files to see the scaffold, then write pages and components.\`;`;

if (content.includes(targetTask)) {
  content = content.replace(targetTask, replacementTask);
  console.log("Task prompt patched successfully.");
} else {
  console.error("Target task prompt NOT found!");
}

// Convert line endings back to CRLF before writing on Windows (optional but good practice)
content = content.replace(/\n/g, "\r\n");

fs.writeFileSync(targetFile, content, "utf-8");
console.log("File written successfully!");
