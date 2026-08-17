import { test, expect } from "bun:test";
import { pickPrimaryTable } from "./index.ts";

// 2026-08-17: real false-deploy-failure found live (fulfillio1) — the
// resource "inventory" prefix-matches BOTH inventory_items and
// inventory_quantities, and the pre-existing "exactly one candidate or
// give up" rule correctly refused to guess between them — but that means
// persistence could NEVER be confirmed for this resource at all, a
// permanent false finding rather than a rare edge case. Verified directly
// against the real live schema: inventory_quantities has a real
// item_id -> inventory_items foreign key; inventory_items has no FK back
// to inventory_quantities. pickPrimaryTable should resolve to the parent.
test("picks inventory_items over inventory_quantities — the real fulfillio1 schema shape", () => {
  const result = pickPrimaryTable(
    ["inventory_items", "inventory_quantities"],
    {
      inventory_items: [],
      inventory_quantities: ["inventory_items", "warehouse_locations", "users"],
    },
  );
  expect(result).toBe("inventory_items");
});

test("returns null when no candidate is a clear parent (both reference each other, or neither references the other)", () => {
  expect(
    pickPrimaryTable(["a_table", "b_table"], { a_table: [], b_table: [] }),
  ).toBe(null);
});

test("returns null when there's a genuine cycle between candidates", () => {
  expect(
    pickPrimaryTable(["a_table", "b_table"], { a_table: ["b_table"], b_table: ["a_table"] }),
  ).toBe(null);
});

test("returns null when more than one candidate qualifies as parent-like", () => {
  // Three candidates, two of which reference nothing in the set — still
  // ambiguous, stays conservative rather than picking arbitrarily.
  expect(
    pickPrimaryTable(
      ["parent_a", "parent_b", "child"],
      { parent_a: [], parent_b: [], child: ["parent_a"] },
    ),
  ).toBe(null);
});

test("resolves cleanly with exactly two candidates and one clear parent", () => {
  expect(
    pickPrimaryTable(["order_items", "orders"], { order_items: ["orders"], orders: [] }),
  ).toBe("orders");
});

test("ignores a foreign key pointing to a table outside the candidate set", () => {
  // inventory_quantities also references warehouse_locations/users, which
  // aren't candidates here — only references WITHIN the candidate set count.
  expect(
    pickPrimaryTable(["inventory_quantities"], { inventory_quantities: ["warehouse_locations"] }),
  ).toBe("inventory_quantities");
});

test("empty candidate list returns null", () => {
  expect(pickPrimaryTable([], {})).toBe(null);
});
