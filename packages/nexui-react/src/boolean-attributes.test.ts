import { describe, expect, test } from "bun:test";
import { syncBooleanAttribute } from "./boolean-attributes.ts";

describe("syncBooleanAttribute", () => {
  test("adds the attribute when controlled state is true", () => {
    const attributes = new Set<string>();
    const host = {
      setAttribute: (name: string) => attributes.add(name),
      removeAttribute: (name: string) => attributes.delete(name),
    };

    syncBooleanAttribute(host, "checked", true);

    expect(attributes.has("checked")).toBe(true);
  });

  test("removes the attribute when controlled state is false", () => {
    const attributes = new Set<string>(["checked"]);
    const host = {
      setAttribute: (name: string) => attributes.add(name),
      removeAttribute: (name: string) => attributes.delete(name),
    };

    syncBooleanAttribute(host, "checked", false);

    expect(attributes.has("checked")).toBe(false);
  });
});
