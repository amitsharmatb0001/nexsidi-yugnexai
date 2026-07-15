// Temporal client singleton — used by API routes to trigger and query workflows.
// Connects to the Temporal server configured in TEMPORAL_ADDRESS.

import { Client, Connection } from "@temporalio/client";
import { projectBuildWorkflow } from "../../../../pipeline/workflows/project-build.ts";

const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS ?? "localhost:7233";
const TASK_QUEUE       = process.env.TEMPORAL_TASK_QUEUE ?? "nexsidi-pipeline";

let _client: Client | null = null;

async function getClient(): Promise<Client> {
  if (_client) return _client;
  const connection = await Connection.connect({ address: TEMPORAL_ADDRESS });
  _client = new Client({ connection });
  return _client;
}

// Start a new project build workflow — idempotent (workflowId prevents duplicates)
export async function startProjectBuild(projectId: string, userRequest: string): Promise<string> {
  const client = await getClient();
  const workflowId = `project-build-${projectId}`;

  const handle = await client.workflow.start(projectBuildWorkflow, {
    taskQueue: TASK_QUEUE,
    workflowId,
    args: [projectId, userRequest],
  });

  return handle.workflowId;
}

// Get the current pipeline state for a project (read the workflow query)
export async function getPipelineStatus(projectId: string): Promise<unknown> {
  const client = await getClient();
  const workflowId = `project-build-${projectId}`;

  try {
    const handle = client.workflow.getHandle(workflowId);
    return await handle.query("getPipelineState");
  } catch {
    return null;
  }
}

// Check if a workflow is currently running
export async function isWorkflowRunning(projectId: string): Promise<boolean> {
  const client = await getClient();
  const workflowId = `project-build-${projectId}`;

  try {
    const handle = client.workflow.getHandle(workflowId);
    const desc = await handle.describe();
    return desc.status.name === "RUNNING";
  } catch {
    return false;
  }
}

// Send signal to active workflow
export async function sendWorkflowSignal(
  projectId: string,
  signalName: string,
  approved: boolean,
): Promise<void> {
  const client = await getClient();
  const workflowId = `project-build-${projectId}`;
  try {
    const handle = client.workflow.getHandle(workflowId);
    await handle.signal(signalName, approved);
  } catch (err) {
    console.error(`Failed to send signal ${signalName} to ${projectId}:`, err);
    throw err;
  }
}
