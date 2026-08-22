/**
 * Fail-closed guard for the file-serving endpoints in routes/artifacts.ts.
 *
 * Real leak found live: GET /api/artifacts/:id/file is unauthenticated by
 * design (app.ts's route allowlist — "build page reachable before login",
 * needed because pre-signup visitors have no session cookie at all, only a
 * shared anonymous placeholder id). That is an intentional product tradeoff
 * this function does not change. What it closes is narrower and unconditional:
 * no build ever needs to serve a credential file's raw content through this
 * endpoint, to ANY caller, authenticated or not. Confirmed live: a generated
 * project's frontend/.env.local (real JWT_SECRET value) was returned in full
 * to a request carrying no cookie at all.
 *
 * Applied regardless of auth state — this is a content-class denylist, not an
 * ownership check, and the two are independent layers.
 */
const SECRET_FILENAMES = new Set([
  "id_rsa",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  "secrets.json",
  "credentials.json",
  "service-account.json",
]);

const SECRET_EXTENSIONS = new Set([".pem", ".key", ".p12", ".pfx", ".jks"]);

export function isSecretPath(path: string): boolean {
  const lower = path.toLowerCase();
  const base = (lower.split("/").pop() ?? lower).trim();

  // ".env", ".env.local", ".env.production", ".env.example" — every variant
  // shares the same filename prefix, so one check covers the family without
  // needing to enumerate every environment suffix a generator might emit.
  if (base === ".env" || base.startsWith(".env.")) return true;

  if (SECRET_FILENAMES.has(base)) return true;

  const dot = base.lastIndexOf(".");
  if (dot !== -1 && SECRET_EXTENSIONS.has(base.slice(dot))) return true;

  return false;
}
