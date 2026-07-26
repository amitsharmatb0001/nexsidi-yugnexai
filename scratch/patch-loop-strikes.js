const fs = require("fs");
const path = require("path");

const target = path.resolve(__dirname, "../packages/agent-runtime/src/loop.ts");
console.log("Reading:", target);
let content = fs.readFileSync(target, "utf-8");

// Normalize line endings to LF
content = content.replace(/\r\n/g, "\n");

const targetEvaluate = `export function evaluateCommandStrike(
  counter: StrikeCounter,
  command: string,
  toolResult: ToolResult,
): { toolResult: ToolResult; exhausted: boolean } {
  if (toolResult.status !== "error") return { toolResult, exhausted: false };

  const signature = buildFailureSignature(command, toolResult.output ?? toolResult.summary);
  const strike = counter.recordFailure(signature);

  if (strike.exhausted) return { toolResult, exhausted: true };

  if (strike.strikes === 3) {
    return {
      toolResult: {
        ...toolResult,
        next_actions: [
          ...(toolResult.next_actions ?? []),
          "This approach failed 3 times with the same error. Do not retry it. Change approach fundamentally or call escalate.",
        ],
      },
      exhausted: false,
    };
  }

  return { toolResult, exhausted: false };
}`;

const replacementEvaluate = `async function diagnoseError(command: string, output: string): Promise<string> {
  const lines = output.split("\\n");
  const errorLine = lines.find(l => l.includes("error TS") || l.includes("Error:") || l.includes("Cannot find module") || l.includes("Module not found")) 
    || lines.find(l => l.trim().startsWith("Err"))
    || lines[0] 
    || "";
    
  if (!errorLine.trim()) return "";
  
  try {
    const query = \`how to resolve compiler error: \${errorLine.trim().slice(0, 150)}\`;
    const searchResult = await execWebSearch({ query, timeout_ms: 10000 });
    if (searchResult.status === "success" && searchResult.output) {
      return \`\\n\\n[DIAGNOSTIC ENGINE SEARCH FINDINGS]\\nPossible resolution suggestions from web search:\\n\${searchResult.output.slice(0, 800)}\\n\`;
    }
  } catch (err) {
    // fall through
  }
  return "";
}

export async function evaluateCommandStrike(
  counter: StrikeCounter,
  command: string,
  toolResult: ToolResult,
): Promise<{ toolResult: ToolResult; exhausted: boolean }> {
  if (toolResult.status !== "error") return { toolResult, exhausted: false };

  const signature = buildFailureSignature(command, toolResult.output ?? toolResult.summary);
  const strike = counter.recordFailure(signature);

  if (strike.exhausted) return { toolResult, exhausted: true };

  let diagAdvice = "";
  if (strike.strikes >= 2) {
    diagAdvice = await diagnoseError(command, toolResult.output ?? toolResult.summary ?? "");
  }

  const nextActions = [...(toolResult.next_actions ?? [])];
  if (strike.strikes === 3) {
    nextActions.push("This approach failed 3 times with the same error. Do not retry it. Change approach fundamentally or call escalate.");
  }
  if (diagAdvice) {
    nextActions.push("Review the DIAGNOSTIC ENGINE SEARCH FINDINGS added to the output to fix this failure.");
  }

  return {
    toolResult: {
      ...toolResult,
      output: (toolResult.output ?? "") + diagAdvice,
      next_actions: nextActions,
    },
    exhausted: false,
  };
}`;

if (content.includes(targetEvaluate)) {
  content = content.replace(targetEvaluate, replacementEvaluate);
  console.log("evaluateCommandStrike patched successfully.");
} else {
  console.error("evaluateCommandStrike target NOT found!");
}

const targetCall = `          const r = execRunCommand(config.sandboxDir, commandArgs, ledger);
          const strike = evaluateCommandStrike(strikeCounter, commandArgs.command, r);`;

const replacementCall = `          const r = execRunCommand(config.sandboxDir, commandArgs, ledger);
          const strike = await evaluateCommandStrike(strikeCounter, commandArgs.command, r);`;

if (content.includes(targetCall)) {
  content = content.replace(targetCall, replacementCall);
  console.log("evaluateCommandStrike call patched successfully.");
} else {
  console.error("evaluateCommandStrike call target NOT found!");
}

fs.writeFileSync(target, content.replace(/\n/g, "\r\n"), "utf-8");
console.log("Patched loop.ts successfully!");
