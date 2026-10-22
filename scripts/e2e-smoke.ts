// End-to-end smoke test of the running platform, using throwaway accounts on localhost.
//
//   bun scripts/e2e-smoke.ts [apiUrl] [webUrl]        # defaults: http://localhost:8080 http://localhost:3000
//
// It signs up two throwaway users (@example.test, removed by the caller afterwards: the emails are printed on the last line),
// and checks the things a person depends on: sign-up and sign-in, the session, creating, reading, renaming, transferring and
// deleting a project, that one user cannot see or touch another's project, that bad input is refused cleanly, and that the web
// app serves its pages. It never calls a model, so it costs nothing and works while the model providers are unavailable.
const API = process.argv[2] ?? "http://localhost:8080";
const WEB = process.argv[3] ?? "http://localhost:3000";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (cond) passed++;
  else failed++;
}

class Client {
  cookie = "";
  async call(method: string, path: string, body?: unknown, base = API) {
    const res = await fetch(base + path, {
      method,
      headers: { "content-type": "application/json", ...(this.cookie ? { cookie: this.cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
    });
    const set = res.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0]!;
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text, headers: res.headers };
  }
}

const stamp = Date.now();
const emailA = `zz-e2e-a-${stamp}@example.test`;
const emailB = `zz-e2e-b-${stamp}@example.test`;
const password = `E2e!${stamp}aA1x`;
const a = new Client();
const b = new Client();

// ── the platform is up ──
const health = await a.call("GET", "/health");
ok("the API answers its health check", health.status === 200 && health.json?.status === "ok");

// ── signed out ──
ok("a signed-out request for projects is refused", (await new Client().call("GET", "/api/projects")).status === 401);
ok("a signed-out request for the account is refused", (await new Client().call("GET", "/api/auth/me")).status === 401);

// ── sign up, session, sign in ──
const up = await a.call("POST", "/api/auth/sign-up", { email: emailA, password });
ok("sign-up creates the account and starts a session", up.status === 201 && a.cookie.length > 0);
ok("the session cookie is not readable by page script (HttpOnly)", /httponly/i.test(up.headers.get("set-cookie") ?? ""));
ok("signing up the same email again is refused without saying why", (await new Client().call("POST", "/api/auth/sign-up", { email: emailA, password })).status === 409);
ok("a weak or malformed sign-up is refused", (await new Client().call("POST", "/api/auth/sign-up", { email: "not-an-email", password: "x" })).status === 400);
const me = await a.call("GET", "/api/auth/me");
ok("the session shows who is signed in", me.status === 200 && JSON.stringify(me.json).includes(emailA));
ok("a wrong password is refused", (await new Client().call("POST", "/api/auth/sign-in", { email: emailA, password: "wrong-password-1A!" })).status === 401);
const again = new Client();
ok("the right password signs in", (await again.call("POST", "/api/auth/sign-in", { email: emailA, password })).status === 200);

// ── projects ──
const empty = await a.call("GET", "/api/projects");
ok("a new account starts with no projects", empty.status === 200 && Array.isArray(empty.json?.projects) && empty.json.projects.length === 0);
ok("a project needs a name", (await a.call("POST", "/api/projects", { context: "no name" })).status === 400);
ok("an over-long name is refused", (await a.call("POST", "/api/projects", { name: "x".repeat(201) })).status === 400);
const created = await a.call("POST", "/api/projects", { name: "Smoke Test Bakery", context: "A small bakery site." });
ok("a project can be created", created.status === 201 && /^[0-9a-f]{12}$/.test(created.json?.id ?? ""), created.json?.id);
const id: string = created.json?.id ?? "000000000000";
const list = await a.call("GET", "/api/projects");
ok("the new project appears in the list", list.json?.projects?.some((p: any) => p.id === id && p.name === "Smoke Test Bakery"));
const one = await a.call("GET", `/api/projects/${id}`);
ok("the project can be read by id", one.status === 200 && JSON.stringify(one.json).includes("Smoke Test Bakery"));
const renamed = await a.call("PATCH", `/api/projects/${id}`, { name: "Smoke Test Bakery 2" });
ok("the project can be renamed", renamed.status === 200, `status ${renamed.status}`);
ok("the new name shows", JSON.stringify((await a.call("GET", `/api/projects/${id}`)).json).includes("Bakery 2"));

// ── one user cannot reach another's project ──
await b.call("POST", "/api/auth/sign-up", { email: emailB, password });
ok("a second account is signed in", (await b.call("GET", "/api/auth/me")).status === 200);
ok("the second account does not see the first one's projects", (await b.call("GET", "/api/projects")).json?.projects?.length === 0);
ok("the second account cannot read the first one's project", (await b.call("GET", `/api/projects/${id}`)).status === 404);
ok("the second account cannot rename it", (await b.call("PATCH", `/api/projects/${id}`, { name: "stolen" })).status === 404);
ok("the second account cannot delete it", (await b.call("DELETE", `/api/projects/${id}`)).status === 404);
// 2026-10-22: the build page's public routes (status, plan, file tree, build plan, chat history, approvals) used to accept
// anyone who knew the project id. A signed-in owner's project now answers only to that owner (middleware/project-access.ts).
ok("the second account cannot read the first one's file tree", (await b.call("GET", `/api/artifacts/${id}/tree`)).status === 404);
ok("the second account cannot read its pipeline status", (await b.call("GET", `/api/pipeline/${id}`)).status === 404);
ok("the second account cannot approve its deploy", (await b.call("POST", `/api/pipeline/${id}/approve-deploy`)).status === 404);
ok("the second account cannot transfer it to itself", (await b.call("POST", `/api/projects/${id}/transfer`, { targetEmail: emailB })).status === 404);

// ── transfer ──
ok("a transfer to yourself is refused", (await a.call("POST", `/api/projects/${id}/transfer`, { targetEmail: emailA })).status === 409);
ok("a transfer to an account that does not exist is refused", (await a.call("POST", `/api/projects/${id}/transfer`, { targetEmail: "nobody-here@example.test" })).status === 404);
const moved = await a.call("POST", `/api/projects/${id}/transfer`, { targetEmail: emailB });
ok("the owner can hand the project to another account", moved.status === 200 && moved.json?.transferredTo === emailB);
ok("the project is now the second account's", (await b.call("GET", `/api/projects/${id}`)).status === 200);
ok("and no longer the first one's", (await a.call("GET", `/api/projects/${id}`)).status === 404);

// ── clean input handling ──
ok("an id with SQL in it is a clean not-found, not a server error", [400, 404].includes((await a.call("GET", "/api/projects/1'%20OR%20'1'='1")).status));
ok("a non-JSON body is a clean error", [400, 415].includes((await a.call("POST", "/api/projects", undefined)).status));
ok("the artifacts route refuses a path-traversal project id", [400, 403, 404].includes((await a.call("GET", "/api/artifacts/..%2F..%2Fetc/tree")).status));

// ── delete and sign out ──
ok("the owner can delete a project", (await b.call("DELETE", `/api/projects/${id}`)).status < 300);
ok("a deleted project is gone", (await b.call("GET", `/api/projects/${id}`)).status === 404);
await a.call("POST", "/api/auth/sign-out");
ok("after signing out the session no longer works", (await a.call("GET", "/api/auth/me")).status === 401);

// ── the web app ──
const home = await fetch(WEB + "/", { redirect: "manual" });
ok("the web home page is served", home.status === 200);
const dash = await fetch(WEB + "/dashboard", { redirect: "manual" });
ok("the dashboard sends a signed-out visitor to sign in", dash.status >= 300 && dash.status < 400 && /sign-in|login|signin/i.test(dash.headers.get("location") ?? ""), dash.headers.get("location") ?? `status ${dash.status}`);
const signin = await fetch(WEB + "/sign-in", { redirect: "manual" });
ok("the sign-in page is served", signin.status === 200, `status ${signin.status}`);
const leak = (await (await fetch(WEB + "/", { redirect: "manual" })).text()).toLowerCase();
ok("the public page names no internal agent", !/tilotma|shubham|aanya|navya|karan|deepika|saanvi/.test(leak));

console.log(`\n${passed} passed, ${failed} failed.`);
console.log(`throwaway accounts: ${emailA} ${emailB}`);
process.exit(failed === 0 ? 0 : 1);
