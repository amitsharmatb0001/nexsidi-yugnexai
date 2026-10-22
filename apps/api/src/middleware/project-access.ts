// Owner check for the build page's public per-project routes (2026-10-22). Those routes skip the sign-in middleware so the
// page works for a project started before sign-in, which left the 12-character project id as the only key: a shared link
// was enough to read a signed-in owner's generated code and approve its deploy (found by the 2026-10-21 smoke test).
// Now a project owned by a signed-in user answers only to that user; anyone else gets 404, so the response does not even
// confirm the project exists. Projects owned by the anonymous account stay open, as before.
import type { Context, Next } from "hono";
import { resolveOptionalUserId } from "./auth.ts";

export const ANON_OWNER = "00000000-0000-0000-0000-000000000000";

export function decideProjectAccess(ownerId: string | null, viewerId: string | null): "allow" | "not_found" {
  if (!ownerId || ownerId === ANON_OWNER) return "allow"; // unknown id: the route answers 404 itself
  return viewerId === ownerId ? "allow" : "not_found";
}

const PUBLIC_PROJECT_PATHS = [
  /^\/api\/pipeline\/([a-f0-9]+)(?:\/(?:status|approve-spec|approve-deploy))?$/,
  /^\/api\/artifacts\/([a-f0-9]+)\/(?:tree|file|build-plan\.json)/,
  /^\/api\/chat\/([a-f0-9]+)$/,
  /^\/ws\/pipeline\/([a-f0-9]+)$/,
];

export function projectIdFromPublicPath(path: string): string | null {
  for (const re of PUBLIC_PROJECT_PATHS) {
    const m = path.match(re);
    if (m) return m[1]!;
  }
  return null;
}

export async function projectAccessGuard(c: Context, next: Next): Promise<Response | void> {
  const projectId = projectIdFromPublicPath(c.req.path);
  if (!projectId) return next();
  let ownerId: string | null = null;
  try {
    const { db, projects } = await import("@nexsidi/db");
    const { eq } = await import("drizzle-orm");
    const [row] = await db.select({ userId: projects.userId }).from(projects).where(eq(projects.id, projectId)).limit(1);
    ownerId = row?.userId ?? null;
  } catch {
    // If the owner cannot be read, refuse rather than open a signed-in owner's project.
    return c.json({ error: "not found" }, 404);
  }
  const viewer = ownerId && ownerId !== ANON_OWNER ? await resolveOptionalUserId(c.req.raw, "") : null;
  if (decideProjectAccess(ownerId, viewer || null) === "allow") return next();
  return c.json({ error: "not found" }, 404);
}
