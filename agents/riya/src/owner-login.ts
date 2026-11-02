// The real sign-in of each limited role (2026-11-02, Brewline 8). Every check passed, and no real staff member could sign in: the app
// made the staff account with a random password that nothing recorded, because one rule said to log it once and a check refused any
// logged password. The checks signed in with a test account given the role, so nothing noticed. Before delivery the system sets each
// role's real account a password, proves it by signing in and opening a page of that role, and keeps it for the owner, beside the
// build's folders and never in what the customer ships or in a log.
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface OwnerLogin {
  role: string;
  email: string;
  password: string;
}

export interface OwnerLoginDeps {
  /** the role's real accounts, without test accounts */
  accounts: (role: string) => string[];
  setPassword: (email: string, password: string) => Promise<void>;
  /** the session token, or null when the sign-in is refused */
  signIn: (email: string, password: string) => Promise<string | null>;
  /** what a page only this role may use answers this token; null when the plan has no such page to read */
  rolePageStatus: (role: string, token: string) => Promise<number | null>;
}

const file = (buildDir: string) => join(buildDir, ".nexsidi", "owner-login.json");

export function readOwnerLogins(buildDir: string): OwnerLogin[] {
  try {
    const logins = JSON.parse(readFileSync(file(buildDir), "utf-8")) as unknown;
    return Array.isArray(logins) ? (logins as OwnerLogin[]) : [];
  } catch {
    return [];
  }
}

export async function provisionOwnerLogins(buildDir: string, roles: string[], deps: OwnerLoginDeps): Promise<{ ok: true; logins: string[] } | { ok: false; reason: string }> {
  const kept = readOwnerLogins(buildDir);
  const logins: OwnerLogin[] = [];
  for (const role of roles) {
    const email = deps.accounts(role)[0];
    if (!email) return { ok: false, reason: `the app has no ${role} account a person could sign in with` };
    const earlier = kept.find((l) => l.role === role && l.email === email);
    let password = earlier?.password;
    let token = password ? await deps.signIn(email, password) : null;
    if (!token) {
      password = randomBytes(15).toString("base64url");
      await deps.setPassword(email, password);
      token = await deps.signIn(email, password);
      if (!token) return { ok: false, reason: `the ${role} account could not sign in with the password just set for it` };
    }
    const status = await deps.rolePageStatus(role, token);
    if (status !== null && (status < 200 || status >= 300)) return { ok: false, reason: `the ${role} account signed in, but a page only ${role} may use answered ${status}` };
    logins.push({ role, email, password: password! });
  }
  mkdirSync(join(buildDir, ".nexsidi"), { recursive: true });
  writeFileSync(file(buildDir), JSON.stringify(logins, null, 2));
  if (logins.length > 0) console.log(`[owner-login] ${logins.map((l) => l.role).join(", ")}: real sign-in proven and kept for the owner`);
  return { ok: true, logins: logins.map((l) => l.role) };
}
