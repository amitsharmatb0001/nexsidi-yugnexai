import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function extractBackendContract(backendDir: string): string {
  const routesDir = join(backendDir, "src", "routes");
  const controllersDir = join(backendDir, "src", "controllers");
  let contractLines: string[] = [];

  const walkAndFindRoutes = (dir: string) => {
    if (!existsSync(dir)) return;
    const items = readdirSync(dir);
    for (const item of items) {
      const full = join(dir, item);
      if (statSync(full).isDirectory()) {
        walkAndFindRoutes(full);
      } else if (item.endsWith(".ts") || item.endsWith(".js")) {
        const content = readFileSync(full, "utf-8");
        // Look forExpress routes e.g., router.get('/tasks', ...)
        const routeRegex = /router\.(get|post|put|delete|patch)\(\s*['"`]([^'"`]+)['"`]/gi;
        let match;
        while ((match = routeRegex.exec(content)) !== null) {
          const method = match[1];
          const path = match[2];
          if (method && path) {
            contractLines.push(`- **${method.toUpperCase()}** \`${path}\` (defined in routes/${item})`);
          }
        }
      }
    }
  };

  const walkAndFindRequestTypes = (dir: string) => {
    if (!existsSync(dir)) return;
    const items = readdirSync(dir);
    for (const item of items) {
      const full = join(dir, item);
      if (statSync(full).isDirectory()) {
        walkAndFindRequestTypes(full);
      } else if (item.endsWith(".ts")) {
        const content = readFileSync(full, "utf-8");
        // Look for request/response type definitions e.g., export interface TaskCreateRequest { ... }
        const typeRegex = /export\s+interface\s+(\w+)\s*\{([^}]+)\}/g;
        let match;
        while ((match = typeRegex.exec(content)) !== null) {
          const typeName = match[1];
          const typeBodyRaw = match[2];
          if (typeName && typeBodyRaw) {
            const typeBody = typeBodyRaw
              .split("\n")
              .map((line) => line.trim())
              .filter(Boolean)
              .join(", ");
            if (typeName.toLowerCase().includes("request") || typeName.toLowerCase().includes("response") || typeName === "Task") {
              contractLines.push(`  - Type \`${typeName}\`: { ${typeBody} }`);
            }
          }
        }
      }
    }
  };

  walkAndFindRoutes(routesDir);
  walkAndFindRoutes(controllersDir); // Fallback search in controllers
  
  const typesDir = join(backendDir, "src", "types");
  if (existsSync(typesDir)) walkAndFindRequestTypes(typesDir);
  else walkAndFindRequestTypes(join(backendDir, "src")); // Fallback search in src

  if (contractLines.length === 0) {
    return "API CONTRACT:\n- No specific Express routes extracted automatically.";
  }

  return `### SHARED API CONTRACT (AUTOMATICALLY EXTRACTED)\nUse this actual API specification to align your client requests:\n\n${contractLines.join("\n")}`;
}

export function saveContract(projectId: string, contract: string): void {
  const buildDir = process.env.BUILD_DIR ?? "E:/tmp/nexsidi-builds";
  const projectBuildDir = join(buildDir, projectId);
  writeFileSync(join(projectBuildDir, "api-contract.md"), contract, "utf-8");
}

export function loadAndInjectContract(projectId: string, basePrompt: string): string {
  const buildDir = process.env.BUILD_DIR ?? "E:/tmp/nexsidi-builds";
  const contractPath = join(buildDir, projectId, "api-contract.md");
  if (existsSync(contractPath)) {
    const contract = readFileSync(contractPath, "utf-8");
    return `${basePrompt}\n\n${contract}`;
  }
  return basePrompt;
}
