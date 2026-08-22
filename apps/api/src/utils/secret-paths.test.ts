import { describe, expect, test } from "bun:test";
import { isSecretPath } from "./secret-paths.ts";

describe("isSecretPath", () => {
  test("blocks .env and every .env variant", () => {
    expect(isSecretPath("backend/.env")).toBe(true);
    expect(isSecretPath(".env")).toBe(true);
    expect(isSecretPath("frontend/.env.local")).toBe(true);
    expect(isSecretPath(".env.production")).toBe(true);
    expect(isSecretPath(".env.example")).toBe(true); // no secrets in it, but same
    // filename-matching rule as the others — consistent, not a judgment call per file.
  });

  test("blocks .env nested arbitrarily deep", () => {
    expect(isSecretPath("a/b/c/d/.env")).toBe(true);
  });

  test("blocks common credential/key filenames", () => {
    expect(isSecretPath("id_rsa")).toBe(true);
    expect(isSecretPath("backend/id_ed25519")).toBe(true);
    expect(isSecretPath("secrets.json")).toBe(true);
    expect(isSecretPath("credentials.json")).toBe(true);
    expect(isSecretPath("service-account.json")).toBe(true);
  });

  test("blocks common key file extensions", () => {
    expect(isSecretPath("backend/server.pem")).toBe(true);
    expect(isSecretPath("backend/server.key")).toBe(true);
    expect(isSecretPath("cert.p12")).toBe(true);
  });

  test("does not block ordinary source files", () => {
    expect(isSecretPath("backend/src/app.ts")).toBe(false);
    expect(isSecretPath("frontend/app/page.tsx")).toBe(false);
    expect(isSecretPath("package.json")).toBe(false);
    expect(isSecretPath("docker-compose.yml")).toBe(false);
    expect(isSecretPath("Dockerfile")).toBe(false);
  });

  test("is not fooled by a directory merely named env", () => {
    // A real directory called "env" (not dotfile) holding ordinary source is
    // a different thing from the dotfile ".env" — must not over-block.
    expect(isSecretPath("env/config.ts")).toBe(false);
  });

  test("matches case-insensitively, since filesystems the app runs on may not be case-sensitive", () => {
    expect(isSecretPath("Backend/.ENV")).toBe(true);
    expect(isSecretPath("SECRETS.JSON")).toBe(true);
  });

  test("is not fooled by a filename that merely contains the substring env", () => {
    expect(isSecretPath("frontend/environment.ts")).toBe(false);
  });
});
