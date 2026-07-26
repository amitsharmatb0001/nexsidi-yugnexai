export { db, type DB } from "./client.ts";
export * from "./schema.ts";
export * from "./instincts.ts";
// 2026-07-25 (Phase 3.1): was importable only via a direct relative path
// into this package's src/ — no consumer outside this file ever did that,
// which is part of why seedInstincts() was never called from the worker.
export { seedInstincts, buildSeedRecords, SPRINT1_SEEDED_INSTINCTS, type SeedInstinct } from "./seed-instincts.ts";
