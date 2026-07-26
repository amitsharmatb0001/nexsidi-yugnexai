import { Client, Connection } from "@temporalio/client";
import { WorkflowFailedError } from "@temporalio/client";
const conn = await Connection.connect({ address: "localhost:7233" });
const client = new Client({ connection: conn });
const handle = client.workflow.getHandle("project-build-nextech8");
try {
    await handle.result();
} catch (e: any) {
    function describeFailure(err: any, depth = 0): void {
        const prefix = "  ".repeat(depth);
        console.log(`${prefix}${err.constructor.name}: ${err.message}`);
        if (err.cause) describeFailure(err.cause, depth + 1);
        if (err.failure) {
            console.log(`${prefix}failure.type: ${err.failure?.applicationFailureInfo?.type || "unknown"}`);
            console.log(`${prefix}failure.nonRetryable: ${err.failure?.applicationFailureInfo?.nonRetryable}`);
            console.log(`${prefix}failure.message: ${err.failure?.message}`);
            if (err.failure.cause) {
                console.log(`${prefix}failure.cause:`, JSON.stringify(err.failure.cause).substring(0, 400));
            }
        }
    }
    describeFailure(e);
}
await conn.close();
