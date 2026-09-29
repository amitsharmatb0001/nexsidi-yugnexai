import { test, expect } from "bun:test";
import { pinFrontendApiUrl, prepareComposeForUp, type ComposeFs } from "./compose-ports.ts";

// 2026-09-29: real bug (project a034f90ba50e), recurring since Sprint 1 ("CORS
// port mismatch"). NEXT_PUBLIC_* values are baked in at `next build` time. The
// launch step writes frontend/.env.local with the real backend port, but a
// Dockerfile ARG/ENV default (e.g. the contract's 3001) overrides .env.local
// during the build, so the browser called http://localhost:3001 while the
// backend listened on 3308 — sign-up/login broken for real users, invisible to
// checks that call the backend directly.
test("pinFrontendApiUrl pins ARG/ENV defaults for NEXT_PUBLIC_API_URL to the real backend URL", () => {
  const df = "FROM node:20\nARG NEXT_PUBLIC_API_URL=http://localhost:3001\nENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL\nRUN npm run build\n";
  expect(pinFrontendApiUrl(df, "http://localhost:3308")).toBe("FROM node:20\nARG NEXT_PUBLIC_API_URL=http://localhost:3308\nENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL\nRUN npm run build\n");
  expect(pinFrontendApiUrl("ENV NEXT_PUBLIC_API_URL=http://localhost:3001\n", "http://localhost:3308")).toBe("ENV NEXT_PUBLIC_API_URL=http://localhost:3308\n");
  expect(pinFrontendApiUrl("ENV NEXT_PUBLIC_API_URL http://backend:3001\n", "http://localhost:3308")).toBe("ENV NEXT_PUBLIC_API_URL=http://localhost:3308\n");
});

test("pinFrontendApiUrl leaves a Dockerfile that never sets it untouched (.env.local then applies)", () => {
  const df = "FROM node:20\nCOPY . .\nRUN npm run build\n";
  expect(pinFrontendApiUrl(df, "http://localhost:3308")).toBe(df);
  expect(pinFrontendApiUrl("ARG NEXT_PUBLIC_API_URL\n", "http://localhost:3308")).toBe("ARG NEXT_PUBLIC_API_URL=http://localhost:3308\n");
});

test("prepareComposeForUp pins the frontend Dockerfile to the URL in frontend/.env.local before every up", () => {
  const files = new Map<string, string>([
    ["/b/docker-compose.yml", 'services:\n  frontend:\n    build: ./frontend\n    ports:\n      - "127.0.0.1:3207:3000"\n'],
    ["/b/frontend/.env.local", "NEXT_PUBLIC_API_URL=http://localhost:3308\nJWT_SECRET=x\n"],
    ["/b/frontend/Dockerfile", "ARG NEXT_PUBLIC_API_URL=http://localhost:3001\nENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL\n"],
  ]);
  const norm = (p: string) => p.split("\\").join("/");
  const fs: ComposeFs = { exists: (p) => files.has(norm(p)), read: (p) => files.get(norm(p))!, write: (p, c) => { files.set(norm(p), c); } };
  expect(prepareComposeForUp("/b", fs).ok).toBe(true);
  expect(files.get("/b/frontend/Dockerfile")).toBe("ARG NEXT_PUBLIC_API_URL=http://localhost:3308\nENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL\n");
});
