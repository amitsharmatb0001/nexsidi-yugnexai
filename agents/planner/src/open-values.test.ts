import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { openValues, openValuesInPlan } from "./open-values.ts";

// 2026-10-29 (team plan, stage 2): a plan that names a business value without giving it ("during store hours", no hours)
// made each builder invent its own (Brewline 3: the frontend 6:30 AM, the backend 8:00 and 6:30). The planner now has
// to ask the customer before the plan can be shown.

test("store hours named without any hours are open", () => {
  const open = openValues(["Customers choose a 15-minute window today starting at least 15 minutes from now during store hours"]);
  expect(open.map((o) => o.fact)).toEqual(["opening hours"]);
  expect(open[0]!.where).toContain("during store hours");
});

test("store hours with times given are not open", () => {
  expect(openValues(["Store hours: Mon–Fri 7:00–18:00, Sat 8am–2pm, closed Sunday"])).toEqual([]);
  expect(openValues(["Open 24/7; pickup during store hours"])).toEqual([]);
});

test("an order limit stated as none is given; a limit with no number is open", () => {
  expect(openValues(["No limit on orders per pickup time."])).toEqual([]);
  expect(openValues(["There is a maximum order per customer."]).map((o) => o.fact)).toEqual(["order limits"]);
  expect(openValues(["Maximum order of 5 drinks per pickup."])).toEqual([]);
});

test("a fee named without an amount is open; an amount or 'no fee' is given", () => {
  expect(openValues(["A delivery fee is added at checkout."]).map((o) => o.fact)).toEqual(["fees"]);
  expect(openValues(["Delivery fee ₹40 per order."])).toEqual([]);
  expect(openValues(["There is no delivery fee."])).toEqual([]);
});

test("tax named without a rate is open; a rate or tax-inclusive prices are given", () => {
  expect(openValues(["GST is added to the invoice."]).map((o) => o.fact)).toEqual(["tax rate"]);
  expect(openValues(["GST at 18% is added to the invoice."])).toEqual([]);
  expect(openValues(["Prices are tax-inclusive."])).toEqual([]);
});

test("a notice or lead time without a duration is open", () => {
  expect(openValues(["Bookings need advance notice."]).map((o) => o.fact)).toEqual(["notice or lead time"]);
  expect(openValues(["Bookings need 24 hours advance notice."])).toEqual([]);
});

test("text with none of these facts has no open values", () => {
  expect(openValues(["Payments are handled in-store at pickup.", "No-shows are reviewed by staff by hand."])).toEqual([]);
});

test("the plan's rules, context, pages and endpoints are all read", () => {
  const plan = {
    appName: "Brewline",
    context: "A coffee shop pre-order site.",
    publicPages: [{ name: "Contact", path: "/contact", description: "Address, phone and daily store hours" }],
    protectedPages: [],
    dbTables: [],
    apiEndpoints: [],
    designDirection: "",
    techStack: { frontend: "", backend: "", database: "", auth: "" },
    rules: ["No limit on orders per pickup time."],
  };
  expect(openValuesInPlan(plan as never).map((o) => o.fact)).toEqual(["opening hours"]);
});

test("the planner does not show a plan with an open value and is told to ask the customer", () => {
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf-8");
  const handler = src.slice(src.indexOf('if (toolCallName === "propose_plan"'), src.indexOf('if (toolCallName === "trigger_build"'));
  expect(handler).toContain("openValuesInPlan(plan)");
  expect(handler).toContain("ask_user");
});
