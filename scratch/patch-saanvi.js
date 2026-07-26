const fs = require("fs");
const path = require("path");

const target = path.resolve(__dirname, "../agents/saanvi/src/index.ts");
console.log("Reading:", target);
let content = fs.readFileSync(target, "utf-8");

content = content.replace(/\r\n/g, "\n");
const lines = content.split("\n");

// Find where parseJson starts (the first occurrence)
const parseJsonIndex = lines.findIndex(line => line.includes("function parseJson"));
console.log("parseJson Index:", parseJsonIndex);

if (parseJsonIndex === -1) {
  console.error("Could not find parseJson!");
  process.exit(1);
}

// Keep everything before parseJsonIndex
const cleanTop = lines.slice(0, parseJsonIndex).join("\n");

const newBottom = `
// ── JSON extraction — handles markdown fences and trailing prose ──────────────
function parseJson(text: string): unknown {
  const fenceMatch = text.match(/```(?:json)?\\s*([\\s\\S]*?)\\s*```/);
  if (fenceMatch?.[1]) {
    try { return JSON.parse(fenceMatch[1]); } catch { /* fall through */ }
  }
  const start = text.indexOf("{");
  const end   = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch { /* fall through */ }
  }
  throw new Error(\`[saanvi] Could not parse JSON from LLM output: \${text.slice(0, 200)}\`);
}

// ── System prompt ─────────────────────────────────────────────────────────────
const SAANVI_SYSTEM_PROMPT = \`\\
You are a requirements analyst. Convert a user's app idea into a precise, structured JSON specification.

Output a single JSON object (no markdown fences, no prose outside the object) matching this schema:

{
  "name": "string — short app name (≤40 chars)",
  "description": "string — 1-3 sentence summary",
  "features": [
    {
      "name": "string",
      "description": "string",
      "userStories": ["As a user I can ..."]
    }
  ],
  "apiEndpoints": [
    {
      "method": "GET | POST | PUT | PATCH | DELETE",
      "path": "/api/v1/...",
      "description": "string",
      "auth": true | false,
      "requestBody": { "field": "type" } | null,
      "responseBody": { "field": "type" }
    }
  ],
  "dbTables": [
    {
      "name": "snake_case_table_name",
      "fields": [
        {
          "name": "id",
          "type": "uuid",
          "nullable": false,
          "primaryKey": true,
          "default": "gen_random_uuid()"
        }
      ]
    }
  ],
  "successCriteria": [
    "User can sign up and log in",
    "User can create, read, update, delete items"
  ]
}

Rules:
- Every table MUST have an id (uuid, primaryKey, default gen_random_uuid()) field.
- Every table MUST have created_at (timestamptz, nullable: false, default: now()) and
  updated_at (timestamptz, nullable: false, default: now()).
- Every user-owned table MUST have user_id (uuid, nullable: false, references users.id).
  Exception: the users table itself.
- Include a "users" table: id (uuid PK), password_hash (text, NOT NULL), email (text, unique, NOT NULL).
- Auth: Custom JWT authentication — design local user registration, login, and JWT middleware.
- Be AMBITIOUS: include all features the user mentioned. Do not simplify or cut corners.
- successCriteria must be measurable user-facing statements.

AUTONOMOUS CONTENT EXPANSION:
- If the user provides a basic prompt (e.g. "landing page", "corporate website", "simple billing"), you MUST expand it into a complete, professional, high-fidelity specification.
- For business or corporate websites, define separate features for distinct pages:
  1. Home Page (Hero section, values, links)
  2. About Us Page (Vision: "To make India a digital economy", Mission, values)
  3. Services/Products Page (Detailed list of IT services: Mobile apps, web apps, CRM, POS, hosting, SMS, marketing)
  4. Contact Page (Inquiry form submitting to backend)
- For database tables, specify descriptive, realistic schemas with rich fields (e.g., categories, prices, status, names) rather than simple generic columns.
- Ensure the description and success criteria reflect a highly customized, functional application.
\`;
`;

const finalContent = cleanTop + newBottom;

fs.writeFileSync(target, finalContent.replace(/\n/g, "\r\n"), "utf-8");
console.log("Patched agents/saanvi/src/index.ts successfully!");
