// Runs in a separate Node process (so a crash in the generated app cannot take the pipeline down): loads the compiled
// backend (dist/app.js, no database, listening on a free local port), calls the contract's endpoints and prints what each
// answered as JSON. Input on stdin: { backendDir, jobs: [{ id, method, path, role? }] }.
const http = require("node:http");
const crypto = require("node:crypto");
const { createRequire } = require("node:module");
const { join } = require("node:path");

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
function signToken(secret, claims) {
  const head = b64({ alg: "HS256", typ: "JWT" });
  const now = Math.floor(Date.now() / 1000);
  const body = b64({ ...claims, iat: now, exp: now + 600 });
  return `${head}.${body}.${crypto.createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url")}`;
}

let input = "";
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", async () => {
  const { backendDir, jobs } = JSON.parse(input);
  const secret = process.env.JWT_SECRET;
  const out = [];
  let server;
  try {
    const mod = createRequire(join(backendDir, "package.json"))(join(backendDir, "dist", "app.js"));
    const app = mod && mod.default ? mod.default : mod;
    server = http.createServer(app);
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const port = server.address().port;
    for (const j of jobs) {
      const headers = { "content-type": "application/json" };
      if (j.role) {
        const id = "00000000-0000-4000-8000-000000000001";
        headers.authorization = "Bearer " + signToken(secret, { id, userId: id, sub: id, email: "check@example.com", role: j.role });
      }
      try {
        const res = await fetch(`http://127.0.0.1:${port}${j.path}`, {
          method: j.method,
          headers,
          body: ["GET", "HEAD"].includes(j.method) ? undefined : "{}",
          signal: AbortSignal.timeout(8000),
        });
        out.push({ id: j.id, status: res.status });
      } catch (err) {
        out.push({ id: j.id, status: null, error: String((err && err.message) || err).slice(0, 120) });
      }
    }
    process.stdout.write(JSON.stringify({ ok: true, results: out }));
  } catch (err) {
    process.stdout.write(JSON.stringify({ ok: false, error: String((err && err.message) || err).slice(0, 300) }));
  } finally {
    if (server) server.close();
    setTimeout(() => process.exit(0), 50);
  }
});
