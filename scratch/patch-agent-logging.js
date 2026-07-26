const fs = require("fs");
const path = require("path");

function patchFile(relativeFilePath, startTarget, startReplacement, endTarget, endReplacement) {
  const filePath = path.resolve(__dirname, relativeFilePath);
  console.log("Reading:", filePath);
  let content = fs.readFileSync(filePath, "utf-8");
  content = content.replace(/\r\n/g, "\n");

  if (content.includes(startTarget)) {
    content = content.replace(startTarget, startReplacement);
    console.log("Start patched successfully.");
  } else {
    console.error("Start target NOT found in", relativeFilePath);
  }

  if (content.includes(endTarget)) {
    content = content.replace(endTarget, endReplacement);
    console.log("End patched successfully.");
  } else {
    console.error("End target NOT found in", relativeFilePath);
  }

  fs.writeFileSync(filePath, content.replace(/\n/g, "\r\n"), "utf-8");
  console.log("Wrote file:", relativeFilePath);
}

// 1. Patch loop.ts
const loopStartTarget = `export async function runAgent(config: AgentRunConfig): Promise<AgentRunResult> {
  const tools: NimToolDef[] = buildToolList(config);`;

const loopStartReplacement = `export async function runAgent(config: AgentRunConfig): Promise<AgentRunResult> {
  const originalLog = console.log;
  const originalError = console.error;
  if (config.projectId) {
    const logToFile = (msg: string) => {
      try {
        const logDir = join(process.env.BUILD_DIR ?? "C:/tmp/nexsidi-builds", config.projectId!, "logs");
        const { mkdirSync, appendFileSync } = require("fs");
        mkdirSync(logDir, { recursive: true });
        appendFileSync(join(logDir, "pipeline.log"), \`\${new Date().toISOString()} [\${config.agentName}] \${msg}\\n\`, "utf-8");
      } catch {}
    };
    console.log = (...args: any[]) => {
      const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(" ");
      logToFile(msg);
      originalLog(...args);
    };
    console.error = (...args: any[]) => {
      const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(" ");
      logToFile(\`[ERROR] \${msg}\`);
      originalError(...args);
    };
  }

  const tools: NimToolDef[] = buildToolList(config);`;

const loopEndTarget = `  } finally {
    if (browserToolset) await browserToolset.close();`;

const loopEndReplacement = `  } finally {
    console.log = originalLog;
    console.error = originalError;
    if (browserToolset) await browserToolset.close();`;

patchFile("../packages/agent-runtime/src/loop.ts", loopStartTarget, loopStartReplacement, loopEndTarget, loopEndReplacement);

// 2. Patch claude-loop.ts
const claudeStartTarget = `export async function runAgentWithClaude(config: AgentRunConfig): Promise<AgentRunResult> {
  const claudeApiKey = process.env.ANTHROPIC_API_KEY ?? "";`;

const claudeStartReplacement = `export async function runAgentWithClaude(config: AgentRunConfig): Promise<AgentRunResult> {
  const originalLog = console.log;
  const originalError = console.error;
  if (config.projectId) {
    const logToFile = (msg: string) => {
      try {
        const logDir = join(process.env.BUILD_DIR ?? "C:/tmp/nexsidi-builds", config.projectId!, "logs");
        const { mkdirSync, appendFileSync } = require("fs");
        mkdirSync(logDir, { recursive: true });
        appendFileSync(join(logDir, "pipeline.log"), \`\${new Date().toISOString()} [\${config.agentName}:claude] \${msg}\\n\`, "utf-8");
      } catch {}
    };
    console.log = (...args: any[]) => {
      const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(" ");
      logToFile(msg);
      originalLog(...args);
    };
    console.error = (...args: any[]) => {
      const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(" ");
      logToFile(\`[ERROR] \${msg}\`);
      originalError(...args);
    };
  }

  const claudeApiKey = process.env.ANTHROPIC_API_KEY ?? "";`;

const claudeEndTarget = `  } finally {
    if (browserToolset) await browserToolset.close();
  }`;

const claudeEndReplacement = `  } finally {
    console.log = originalLog;
    console.error = originalError;
    if (browserToolset) await browserToolset.close();
  }`;

patchFile("../packages/agent-runtime/src/claude-loop.ts", claudeStartTarget, claudeStartReplacement, claudeEndTarget, claudeEndReplacement);
