import { checkBudget } from "../packages/agent-runtime/src/cost-budget.ts";
console.log((await checkBudget("52c4d13c5e0d")).spentUsd.toFixed(2)); process.exit(0);
