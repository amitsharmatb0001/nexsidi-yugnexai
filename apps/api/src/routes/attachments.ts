import { Hono } from "hono";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

type Env = { Variables: { userId: string } };
export const attachmentsRouter = new Hono<Env>();

attachmentsRouter.post("/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  if (!projectId) return c.json({ error: "projectId required" }, 400);

  try {
    const body = await c.req.parseBody();
    
    // Support single or multiple files
    const files: any[] = [];
    if (body.files) {
      if (Array.isArray(body.files)) {
        files.push(...body.files);
      } else {
        files.push(body.files);
      }
    } else if (body.file) {
      files.push(body.file);
    } else {
      // Check all keys for files
      for (const [key, value] of Object.entries(body)) {
        if (value instanceof File) {
          files.push(value);
        }
      }
    }

    if (files.length === 0) {
      return c.json({ error: "No files provided" }, 400);
    }

    const buildDir = process.env.BUILD_DIR ?? "C:/tmp/nexsidi-builds";
    const attachmentsDir = join(buildDir, projectId, "attachments");
    mkdirSync(attachmentsDir, { recursive: true });

    const savedFiles: string[] = [];

    for (const file of files) {
      if (file instanceof File) {
        const buffer = await file.arrayBuffer();
        const filePath = join(attachmentsDir, file.name);
        writeFileSync(filePath, Buffer.from(buffer));
        savedFiles.push(file.name);
      }
    }

    return c.json({
      success: true,
      projectId,
      files: savedFiles,
    });
  } catch (err) {
    console.error("[attachments] Failed to save attachments:", err);
    return c.json({ error: "Internal server error saving attachments" }, 500);
  }
});
