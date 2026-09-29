import { test, expect } from "bun:test";
import { reviewDbUrl } from "./compose-ports.ts";

// 2026-09-29 (project a034f90ba50e): db.ts says Stage 6 sets TIER3_DB_URL, but
// nothing ever did — every live review reported "db_query unavailable" as a
// finding and could not check that data really landed. The review gets the
// deployed database at its published loopback port.
const COMPOSE = `services:
  postgres:
    image: postgres:16-alpine
    ports:
      - "127.0.0.1:5435:5432"
  backend:
    build: ./backend
    ports:
      - "127.0.0.1:3308:3001"
    environment:
      DATABASE_URL: postgresql://postgres:postgres@postgres:5432/plantly
`;

test("reviewDbUrl points the backend's DATABASE_URL at the database's published host port", () => {
  expect(reviewDbUrl(COMPOSE)).toBe("postgresql://postgres:postgres@127.0.0.1:5435/plantly");
});

test("reviewDbUrl reads the list form and a service named db", () => {
  const compose = COMPOSE.replace(/postgres:\n    image/, "db:\n    image")
    .replace("DATABASE_URL: postgresql://postgres:postgres@postgres:5432/plantly", "- DATABASE_URL=postgresql://app:pw@db:5432/app");
  expect(reviewDbUrl(compose)).toBe("postgresql://app:pw@127.0.0.1:5435/app");
});

test("reviewDbUrl is null when there is no DATABASE_URL or the database port is not published", () => {
  expect(reviewDbUrl("services:\n  backend:\n    build: .\n")).toBeNull();
  expect(reviewDbUrl(COMPOSE.replace('      - "127.0.0.1:5435:5432"\n', ""))).toBeNull();
});
