// Projects routes — create, list, fetch, rename and delete a user's project
// records.
//
// POST   /api/projects       — create a new project (name + context)
// GET    /api/projects       — all projects for the authenticated user
// GET    /api/projects/:id   — single project (ownership verified)
// PATCH  /api/projects/:id   — rename (ownership verified)
// DELETE /api/projects/:id   — remove the project record (ownership verified)

import { Hono } from "hono";
import { db, projects, tokenSpend, users } from "@nexsidi/db";
import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getPipelineStatus } from "../utils/temporal.ts";
import { translateStage } from "../utils/stage-labels.ts";

type Env = { Variables: { userId: string } };
export const projectsRouter = new Hono<Env>();

interface ProjectRow {
  id: string;
  name: string;
  status: string;
  appUrl: string | null;
  githubRepo: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** Only present on the single-project fetch — the list view omits it to
   * keep every row response small regardless of how long a context runs. */
  context?: string | null;
}

/**
 * Attaches the real, deny-by-default pipeline stage and cost figures to a row.
 *
 * `iteration` is deliberately never selected by either route below — it was
 * previously returned in every list/detail response even though no screen
 * rendered it, which is exactly the kind of latent leak "no iteration count
 * to the user" means to close: a field absent from the UI can still be read
 * straight off the network response.
 *
 * Stage is only queried from Temporal while the project is actually building;
 * a finished or failed project has no running workflow to ask, and the two
 * failure states are unambiguous on their own.
 */
async function enrich(row: ProjectRow) {
  const [spend] = await db
    .select({
      costUsd: tokenSpend.totalCostUsd,
      tokensIn: tokenSpend.totalTokensIn,
      tokensOut: tokenSpend.totalTokensOut,
    })
    .from(tokenSpend)
    .where(eq(tokenSpend.projectId, row.id))
    .limit(1);

  let stage: string | null = null;
  let stageMessage: string;
  let needsApproval = false;

  if (row.status === "building") {
    const state = (await getPipelineStatus(row.id).catch(() => null)) as { stage?: string } | null;
    const translated = state?.stage ? translateStage(state.stage) : null;
    // A stage Temporal reports but the deny-by-default map doesn't recognize
    // must not leak as raw text — fall back to the same generic message the
    // "unknown status" branch below uses.
    stage = translated?.stage ?? null;
    stageMessage = translated?.message ?? "Working on it...";
    needsApproval = translated?.needsApproval ?? false;
  } else if (row.status === "done") {
    stage = "done";
    stageMessage = "Your app is ready!";
  } else if (row.status === "failed") {
    stage = "error";
    stageMessage = "Something went wrong. We're on it.";
  } else if (row.status === "planning") {
    stage = "planning";
    stageMessage = "Working out the plan…";
  } else {
    stageMessage = "Queued...";
  }

  return {
    id: row.id,
    name: row.name,
    status: row.status,
    appUrl: row.appUrl,
    githubRepo: row.githubRepo,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.context !== undefined ? { context: row.context } : {}),
    stage,
    stageMessage,
    needsApproval,
    costUsd: spend?.costUsd ?? "0",
    tokensIn: spend?.tokensIn ?? 0,
    tokensOut: spend?.tokensOut ?? 0,
  };
}

function newProjectId(): string {
  // Same scheme the client used to generate ids before this endpoint existed
  // (crypto.randomUUID, hyphens stripped, first 12 chars) — kept identical so
  // /api/chat's normalizeProjectId (which expects [a-z0-9]{1,12}) never has
  // to hash-fold an id this route produces.
  return randomUUID().replace(/-/g, "").slice(0, 12);
}

// ── POST /api/projects ────────────────────────────────────────────────────────
// Creates the project row immediately, with a real name and its founding
// context — rather than the previous flow, where clicking "New project" only
// generated a client-side id and navigated to a page with no database row
// behind it at all. No row, no name, nothing in the project list existed
// until the planner finished the whole conversation and called
// trigger_build; an abandoned mid-chat project left no trace anywhere.
//
// `context` becomes the seed message the caller sends to POST /api/chat
// immediately after this returns (sessionId = the returned id) — this route
// itself does not talk to the planner, so a validation failure here can
// never leave a half-started chat session behind.
projectsRouter.post("/", async (c) => {
  const userId = c.get("userId") as string;

  const body = (await c.req.json().catch(() => null)) as { name?: unknown; context?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const context = typeof body?.context === "string" ? body.context.trim() : "";

  if (!name) return c.json({ error: "name_required" }, 400);
  if (name.length > 200) return c.json({ error: "name_too_long" }, 400);
  if (!context) return c.json({ error: "context_required" }, 400);
  if (context.length > 8000) return c.json({ error: "context_too_long" }, 400);

  // Collision odds on a 12-hex-char id are negligible (16^12), but the id is
  // also this project's primary key and its on-disk build directory name —
  // worth one real retry rather than a 500 on the one-in-trillions case.
  for (let attempt = 0; attempt < 3; attempt++) {
    const id = newProjectId();
    const existing = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, id)).limit(1);
    if (existing.length > 0) continue;

    await db.insert(projects).values({ id, userId, name, status: "planning", context });
    return c.json({ id, name }, 201);
  }

  return c.json({ error: "could_not_allocate_id" }, 500);
});

// ── GET /api/projects ─────────────────────────────────────────────────────────
projectsRouter.get("/", async (c) => {
  const userId = c.get("userId") as string;

  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      status: projects.status,
      appUrl: projects.appUrl,
      githubRepo: projects.githubRepo,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
    })
    .from(projects)
    .where(eq(projects.userId, userId))
    .orderBy(desc(projects.createdAt));

  const enriched = await Promise.all(rows.map(enrich));
  return c.json({ projects: enriched });
});

// ── GET /api/projects/:id ─────────────────────────────────────────────────────
projectsRouter.get("/:id", async (c) => {
  const userId = c.get("userId") as string;
  const projectId = c.req.param("id");

  const [row] = await db
    .select({
      id: projects.id,
      name: projects.name,
      status: projects.status,
      appUrl: projects.appUrl,
      githubRepo: projects.githubRepo,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
      context: projects.context,
    })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1);

  if (!row) return c.json({ error: "not_found" }, 404);

  return c.json(await enrich(row));
});

// ── GET /api/projects/:id/similar ─────────────────────────────────────────────
// 2026-09-01: real user request — "as we build more projects, the system
// should understand what type a project is (page count, auth, admin panel,
// contact form, etc.) so a new one that's 70-80% the same as an existing
// one can be cloned from it instead of generated from scratch every time."
// Ranks this user's other delivered projects by shape similarity against
// the given one, using each project's own locked spec.json (the real
// source of truth — see project-shape.ts's own header comment) plus the
// real page count on disk. Scoped to the requesting user's own projects
// only — this never compares across different users' portfolios.
projectsRouter.get("/:id/similar", async (c) => {
  const userId    = c.get("userId") as string;
  const projectId = c.req.param("id");

  const { readFileSync, existsSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { countAppPages } = await import("../../../../agents/tilotma/src/tier3-review.ts");
  const { deriveProjectShape, rankBySimilarity } = await import("../../../../pipeline/orchestrator/project-shape.ts");
  const BUILD_DIR = process.env.BUILD_DIR ?? "E:/tmp/nexsidi-builds";

  const readShape = (pid: string) => {
    const specPath = join(BUILD_DIR, pid, "spec.json");
    if (!existsSync(specPath)) return null;
    try {
      const spec = JSON.parse(readFileSync(specPath, "utf-8"));
      const pageCount = countAppPages(join(BUILD_DIR, pid, "frontend"));
      return deriveProjectShape(spec, pageCount);
    } catch {
      return null; // malformed/partial spec.json — skip rather than crash the whole comparison
    }
  };

  const [target] = await db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.userId, userId))).limit(1);
  if (!target) return c.json({ error: "not_found" }, 404);

  const targetShape = readShape(projectId);
  if (!targetShape) return c.json({ error: "no_spec_available", message: "This project has no readable spec.json to compare from." }, 409);

  const others = await db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(and(eq(projects.userId, userId), eq(projects.status, "done")));

  const candidates = others
    .filter((p) => p.id !== projectId)
    .map((p) => ({ projectId: p.id, name: p.name, shape: readShape(p.id) }))
    .filter((p): p is { projectId: string; name: string; shape: NonNullable<ReturnType<typeof readShape>> } => p.shape !== null);

  const ranked = rankBySimilarity(targetShape, candidates);
  const nameById = new Map(candidates.map((cnd) => [cnd.projectId, cnd.name]));

  return c.json({
    projectId,
    shape: targetShape,
    matches: ranked.map((r) => ({
      projectId: r.projectId,
      name: nameById.get(r.projectId) ?? r.projectId,
      score: Math.round(r.comparison.score * 100) / 100,
      shared: r.comparison.shared,
      different: r.comparison.different,
    })),
  });
});

// ── POST /api/projects/:id/clone ──────────────────────────────────────────────
// 2026-09-01: real user request — "build 4-5 projects that are 70-80% the
// same, just names/pieces changed, so we can control cost and show
// something live without breaking." Deliberately NOT the full spec ->
// generate -> adversarial QA -> two Tilotma review passes pipeline every
// other project goes through (that's where the real time/cost goes) —
// copies the source's already-generated, already-QA-passed code and does a
// deterministic name/branding swap (see clone-project.ts's own header
// comment for why this is scoped to name-level changes, not deeper content
// variation). V1 is synchronous: the HTTP response doesn't return until the
// clone is copied, rebranded, built, and deployed — a real docker build
// takes tens of seconds, same as every rebuild done by hand tonight;
// background-job infra for this is a reasonable follow-up, not required
// for a working v1.
// 2026-09-01 (v2, same-day follow-up): optional `changes` field closes the
// exact gap clone-project.ts's header comment already flagged — "deeper
// content variation... needs an LLM-assisted pass and is a natural v2, not
// built here." Runs AFTER the deterministic rename (so the agent starts from
// an already-correctly-renamed app, never touching ports/Dockerfile/compose —
// clone-changes.ts scopes it to frontend/ only) and BEFORE the docker build,
// so one rebuild picks up both the rename and the requested changes together.
// 2026-09-06: real user request — "don't mention which project to clone,
// let the system decide." sourceId "auto" (in place of a real project id)
// triggers clone-source-picker.ts: given the new `description` field and
// the user's own real "done" projects, a one-shot call picks the closest
// structural match — then everything below runs completely unchanged
// against whichever real id it resolved to.
// 2026-09-27: customer-facing name is "Express Build" (was POST /:id/clone).
// "Clone" told customers their project started from someone else's, and the
// response named the source project. The starting project now travels in the
// body as `basedOn` (omitted = the system picks), never in the URL, and the
// source's identity and every raw internal error go to the server log only.
projectsRouter.post("/express-build", async (c) => {
  const userId = c.get("userId") as string;

  const body = (await c.req.json().catch(() => null)) as { name?: unknown; changes?: unknown; description?: unknown; basedOn?: unknown } | null;
  const newName = typeof body?.name === "string" ? body.name.trim() : "";
  if (!newName) return c.json({ error: "name_required" }, 400);
  if (newName.length > 200) return c.json({ error: "name_too_long" }, 400);
  const changes = typeof body?.changes === "string" ? body.changes.trim() : "";
  if (changes.length > 4000) return c.json({ error: "changes_too_long" }, 400);
  const description = typeof body?.description === "string" ? body.description.trim() : "";
  let sourceId = typeof body?.basedOn === "string" && body.basedOn.trim() ? body.basedOn.trim() : "auto";

  let sourcePickReasoning: string | null = null;
  if (sourceId === "auto") {
    if (!description) {
      return c.json({ error: "description_required", message: "Describe the site you want, so Express Build can find the best starting point." }, 400);
    }
    const { pickCloneSource } = await import("../../../../pipeline/orchestrator/clone-source-picker.ts");
    const { readFileSync: readFileSyncForPick, existsSync: existsSyncForPick } = await import("node:fs");
    const { join: joinForPick } = await import("node:path");
    const BUILD_DIR_FOR_PICK = process.env.BUILD_DIR ?? "E:/tmp/nexsidi-builds";

    const doneProjects = await db.select({ id: projects.id, name: projects.name }).from(projects).where(and(eq(projects.userId, userId), eq(projects.status, "done")));
    if (doneProjects.length === 0) return c.json({ error: "no_candidates", message: "Express Build needs at least one finished project on your account." }, 409);

    const candidates = doneProjects.map((p) => {
      const specPath = joinForPick(BUILD_DIR_FOR_PICK, p.id, "spec.json");
      let description = p.name;
      if (existsSyncForPick(specPath)) {
        try {
          const spec = JSON.parse(readFileSyncForPick(specPath, "utf-8"));
          if (typeof spec.description === "string" && spec.description) description = spec.description;
        } catch {
          // fall through to the name-only fallback below
        }
      }
      return { id: p.id, name: p.name, description };
    });

    try {
      const picked = await pickCloneSource(description, candidates, process.env.NIM_API_KEY ?? "");
      sourceId = picked.sourceId;
      sourcePickReasoning = picked.reasoning;
    } catch (err) {
      console.error(`[express-build] picking a starting point failed: ${String(err)}`);
      return c.json({ error: "express_build_failed", message: "Express Build couldn't start. Please try again." }, 502);
    }
  }

  const [source] = await db.select().from(projects).where(and(eq(projects.id, sourceId), eq(projects.userId, userId))).limit(1);
  if (!source) return c.json({ error: "not_found" }, 404);
  if (source.status !== "done") {
    return c.json({ error: "base_not_ready", message: "That project isn't finished yet." }, 409);
  }

  const { readFileSync, existsSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { cloneProject, parseComposePorts } = await import("../../../../pipeline/orchestrator/clone-project.ts");
  const { applyCloneChanges } = await import("../../../../pipeline/orchestrator/clone-changes.ts");
  const { planCloneChanges } = await import("../../../../pipeline/orchestrator/clone-plan.ts");
  const { applyCloneBackendChanges } = await import("../../../../pipeline/orchestrator/clone-backend-changes.ts");
  const { checkCrossLayerContract } = await import("../../../../pipeline/orchestrator/clone-contract-check.ts");
  const { deployWithRetry } = await import("../../../../pipeline/orchestrator/clone-deploy.ts");
  const { getRunningDeploymentPorts } = await import("../../../../agents/riya/src/index.ts");
  const BUILD_DIR = process.env.BUILD_DIR ?? "E:/tmp/nexsidi-builds";

  const sourceSpecPath = join(BUILD_DIR, sourceId, "spec.json");
  if (!existsSync(sourceSpecPath)) {
    console.error(`[express-build] base ${sourceId} has no spec.json`);
    return c.json({ error: "base_unusable" }, 409);
  }
  const sourceSpec = JSON.parse(readFileSync(sourceSpecPath, "utf-8"));
  const oldName = sourceSpec.name as string;

  const sourceComposePath = join(BUILD_DIR, sourceId, "docker-compose.yml");
  if (!existsSync(sourceComposePath)) {
    console.error(`[express-build] base ${sourceId} has no docker-compose.yml`);
    return c.json({ error: "base_unusable" }, 409);
  }
  const sourcePorts = parseComposePorts(readFileSync(sourceComposePath, "utf-8"));
  if (!sourcePorts) {
    console.error(`[express-build] base ${sourceId}: ports unreadable`);
    return c.json({ error: "base_unusable" }, 409);
  }

  // The new project's own request (never the base project's customer's).
  const requestText = [newName, description, changes ? `Requested changes:\n${changes}` : ""].filter(Boolean).join("\n\n");
  const hasOwnRequest = Boolean(description || changes);

  // Same collision-retry as POST / above — id is both the primary key and
  // the on-disk build directory name.
  for (let attempt = 0; attempt < 3; attempt++) {
    const newId = newProjectId();
    const existingRow = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, newId)).limit(1);
    if (existingRow.length > 0) continue;

    let cloneResult: Awaited<ReturnType<typeof cloneProject>>;
    try {
      cloneResult = await cloneProject({ sourceProjectId: sourceId, newProjectId: newId, oldName, newName, sourcePorts, buildDir: BUILD_DIR, ...(hasOwnRequest ? { requestText } : {}) });
    } catch (err) {
      console.error(`[express-build] ${newId} from ${sourceId} failed: ${String(err)}`);
      return c.json({ error: "express_build_failed", message: "Express Build couldn't create the project. Please try again." }, 500);
    }
    console.log(`[express-build] ${newId} "${newName}" based on ${sourceId} ("${source.name}")${sourcePickReasoning ? ` — ${sourcePickReasoning}` : ""}; theme: ${cloneResult.theme.applied ? `accent ${cloneResult.theme.newAccent}` : `unchanged (${cloneResult.theme.reason})`}`);

    await db.insert(projects).values({
      id: newId,
      userId,
      name: newName,
      status: "building",
      context: [description, changes ? `Requested changes: ${changes}` : ""].filter(Boolean).join("\n\n") || newName,
    });

    // Optional content-edit pass — runs AFTER the deterministic rename
    // (destDir already carries the new name everywhere) and BEFORE the
    // docker build, so one rebuild picks up everything together. Never
    // blocks the clone: if this can't fully apply the request, whatever it
    // DID write is still on disk, and the build step right below is the
    // same real verification gate either way — it fails honestly
    // (deploy_failed) if a partial edit broke the build, or succeeds with
    // the clone as-is if it didn't.
    //
    // 2026-09-02: real live test found the actual failure this planning
    // step exists for — a request needing a genuinely new backend feature
    // (a wishlist), handed to the frontend-only agent with zero upfront
    // knowledge of what already existed, burned its entire iteration budget
    // re-discovering the project's own structure by reading files one at a
    // time, then ran out of budget mid-edit having never touched anything
    // it could actually finish. planCloneChanges reads the project's REAL
    // api-contract.json/db-schema.json first and decides, before any
    // building starts, whether backend work is genuinely needed and what
    // each layer should build — closing that gap at the root instead of
    // hoping the frontend agent works it out from scratch.
    let changesApplied: boolean | null = null;
    let changesSummary: string | null = null;
    let changesErrors: string[] = [];
    let planReasoning: string | null = null;
    let backendApplied: boolean | null = null;
    let backendSummary: string | null = null;
    let backendErrors: string[] = [];
    let migrationApplied: string | null = null;
    if (changes) {
      const apiKey = process.env.NIM_API_KEY ?? "";
      let plan: Awaited<ReturnType<typeof planCloneChanges>>;
      try {
        plan = await planCloneChanges({ buildDir: cloneResult.buildDir, changes, apiKey });
      } catch (err) {
        // Fails open: if planning itself breaks (bad LLM response, network
        // error), fall back to the pre-planning behavior — one frontend-only
        // pass on the user's raw request — rather than failing the whole
        // clone over a planning-step hiccup.
        console.warn(`[express-build] ${newId}: change planning failed, defaulting to frontend-only: ${String(err)}`);
        plan = { needsBackendChanges: false, reasoning: "planning failed, defaulted to frontend-only", backendInstructions: null, frontendInstructions: changes };
      }
      planReasoning = plan.reasoning;

      let backendContext: string | undefined;
      if (plan.needsBackendChanges && plan.backendInstructions) {
        const backendResult = await applyCloneBackendChanges({
          buildDir: cloneResult.buildDir,
          instructions: plan.backendInstructions,
          apiKey,
        });
        backendApplied = backendResult.applied;
        backendSummary = backendResult.summary;
        backendErrors = backendResult.errors;
        migrationApplied = backendResult.migrationApplied;
        if (backendResult.applied) backendContext = backendResult.summary;
      }

      // Always the user's own original words, never a paraphrase of them —
      // only the SUPPLEMENTARY backend-context note comes from the plan.
      const changeResult = await applyCloneChanges({
        buildDir: cloneResult.buildDir,
        changes,
        newName,
        apiKey,
        backendContext,
      });
      changesApplied = changeResult.applied;
      changesSummary = changeResult.summary;
      changesErrors = changeResult.errors;

      // 2026-09-02: real live bug found and reproduced exactly — a backend
      // pass and a frontend pass each independently pass their OWN build/
      // typecheck while silently disagreeing about the actual HTTP contract
      // between them (a real run built POST /wishlist/:dropId on the
      // backend, then called POST /api/v1/wishlist with the id in the body
      // instead — both sides compiled clean, the feature 404s at runtime).
      // Only runs when a backend pass actually happened — a pure content
      // edit has nothing new to cross-check. Deterministic source
      // inspection, zero LLM cost, scoped to only the files this run just
      // wrote so a pre-existing (already-working-in-production) call
      // elsewhere in the app is never mistaken for a new regression.
      if (backendContext) {
        const contractResult = checkCrossLayerContract({ buildDir: cloneResult.buildDir, frontendFilesWritten: changeResult.filesWritten });
        if (contractResult.checked && contractResult.mismatches.length > 0) {
          await db.update(projects).set({ status: "error", failureReason: "express_build_contract_mismatch", updatedAt: new Date() }).where(eq(projects.id, newId));
          return c.json({
            error: "contract_mismatch",
            message: "The frontend calls an endpoint the backend never registered — the two layers disagree on the real request shape.",
            mismatches: contractResult.mismatches,
            projectId: newId, planReasoning, backendApplied, backendSummary, backendErrors, migrationApplied, changesApplied, changesSummary, changesErrors,
          }, 502);
        }
      }
    }

    try {
      // 2026-09-06: real bug reproduced twice — see clone-deploy.ts's own
      // header comment. A bounded retry, not a longer timeout, is the fix:
      // both real failures were a transient Windows spawn glitch, and a
      // manual re-run of the identical command succeeded in under 90s both
      // times, well inside the existing budget.
      await deployWithRetry(join(cloneResult.buildDir, "docker-compose.yml"));
    } catch (err) {
      await db.update(projects).set({ status: "error", failureReason: "express_build_deploy_failed", updatedAt: new Date() }).where(eq(projects.id, newId));
      console.error(`[express-build] ${newId}: deploy failed: ${String(err)}`);
      return c.json({ error: "deploy_failed", message: "The new project didn't start. The details are in the server log.", projectId: newId, planReasoning, backendApplied, backendSummary, backendErrors, migrationApplied, changesApplied, changesSummary, changesErrors }, 502);
    }

    // 2026-09-02: `docker compose up -d` can return success once containers
    // are STARTED, even when one is still crash-looping toward "healthy" —
    // exactly what a malformed MIGRATION_REQUEST.sql would cause (postgres
    // never becomes healthy, backend's `depends_on: condition:
    // service_healthy` blocks it from ever actually starting). A bounded
    // retry gives real init/healthcheck time to finish before concluding
    // the deploy is genuinely broken, without waiting the full 300s budget
    // an unrelated hang would need.
    let livePorts: ReturnType<typeof getRunningDeploymentPorts> = null;
    for (let check = 0; check < 5 && !livePorts; check++) {
      if (check > 0) await new Promise((r) => setTimeout(r, 2000));
      livePorts = getRunningDeploymentPorts(cloneResult.buildDir);
    }
    if (!livePorts) {
      await db.update(projects).set({ status: "error", failureReason: "express_build_unhealthy", updatedAt: new Date() }).where(eq(projects.id, newId));
      return c.json({ error: "deploy_unhealthy", message: "docker compose reported success but the containers never became reachable on their expected ports — likely a bad migration or a crash-looping service", projectId: newId, planReasoning, backendApplied, backendSummary, backendErrors, migrationApplied, changesApplied, changesSummary, changesErrors }, 502);
    }

    const appUrl = `http://localhost:${cloneResult.ports.frontendPort}`;
    await db.update(projects).set({ status: "done", appUrl, updatedAt: new Date() }).where(eq(projects.id, newId));

    return c.json({
      id: newId,
      name: newName,
      appUrl,
      ports: cloneResult.ports,
      ...(changes ? { planReasoning, backendApplied, backendSummary, backendErrors, migrationApplied, changesApplied, changesSummary, changesErrors } : {}),
    }, 201);
  }

  return c.json({ error: "could_not_allocate_id" }, 500);
});

// ── PATCH /api/projects/:id ───────────────────────────────────────────────────
// Rename and/or update the project's own context — the dashboard's inline
// "rename project" action, and the IDE's Context panel, share this route.
// Both fields are optional and independent: saving a context edit must not
// require re-sending the name, and vice versa.
projectsRouter.patch("/:id", async (c) => {
  const userId    = c.get("userId") as string;
  const projectId = c.req.param("id");

  const body = await c.req.json().catch(() => null) as { name?: unknown; context?: unknown } | null;

  const set: { name?: string; context?: string; updatedAt: Date } = { updatedAt: new Date() };

  if (body?.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return c.json({ error: "name_required" }, 400);
    if (name.length > 200) return c.json({ error: "name_too_long" }, 400);
    set.name = name;
  }

  if (body?.context !== undefined) {
    const context = typeof body.context === "string" ? body.context.trim() : "";
    if (context.length > 8000) return c.json({ error: "context_too_long" }, 400);
    set.context = context;
  }

  if (set.name === undefined && set.context === undefined) {
    return c.json({ error: "nothing_to_update" }, 400);
  }

  const [row] = await db
    .update(projects)
    .set(set)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .returning({ id: projects.id, name: projects.name, context: projects.context });

  if (!row) return c.json({ error: "not_found" }, 404);

  return c.json(row);
});

// ── DELETE /api/projects/:id ──────────────────────────────────────────────────
// Removes the project's DB record only — the dashboard's own list entry.
// Build output on disk (E:/tmp/nexsidi-builds/<id>) and any deployed
// containers are untouched: deleting those is a materially different,
// destructive action (frees a port, stops a live app, discards generated
// source) that a project-list "delete" click should not silently trigger
// alongside a rename-shaped request. If a follow-up wants full teardown,
// that belongs behind its own explicit, separately-confirmed action.
projectsRouter.delete("/:id", async (c) => {
  const userId    = c.get("userId") as string;
  const projectId = c.req.param("id");

  const [row] = await db
    .delete(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .returning({ id: projects.id });

  if (!row) return c.json({ error: "not_found" }, 404);

  return c.body(null, 204);
});

// ── POST /api/projects/:id/transfer ───────────────────────────────────────────
// 2026-09-06: real user request — accounts had drifted (test accounts, an
// orphaned placeholder owner, a throwaway project ended up owned by a
// disposable session) and there was no way to consolidate everything onto
// one real account short of a direct DB edit. Only the CURRENT owner can
// transfer a project they own, to a target identified by real email (never
// a raw user id — nobody should need to know or type a UUID for this).
// Immediate, one-step transfer: this is a single-operator consolidation
// tool, not a multi-tenant handoff needing the recipient's acceptance.
projectsRouter.post("/:id/transfer", async (c) => {
  const userId = c.get("userId") as string;
  const projectId = c.req.param("id");

  const body = (await c.req.json().catch(() => null)) as { targetEmail?: unknown } | null;
  const targetEmail = typeof body?.targetEmail === "string" ? body.targetEmail.trim().toLowerCase() : "";
  if (!targetEmail) return c.json({ error: "target_email_required" }, 400);

  const [project] = await db.select({ id: projects.id, name: projects.name }).from(projects).where(and(eq(projects.id, projectId), eq(projects.userId, userId))).limit(1);
  if (!project) return c.json({ error: "not_found", message: "No project with that id owned by you." }, 404);

  const [targetUser] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.email, targetEmail)).limit(1);
  if (!targetUser) return c.json({ error: "target_user_not_found", message: `No account exists with email "${targetEmail}" — it must already exist, this does not create one.` }, 404);

  if (targetUser.id === userId) return c.json({ error: "already_owner", message: "That account already owns this project." }, 409);

  await db.update(projects).set({ userId: targetUser.id, updatedAt: new Date() }).where(eq(projects.id, projectId));

  return c.json({ id: projectId, name: project.name, transferredTo: targetUser.email });
});
