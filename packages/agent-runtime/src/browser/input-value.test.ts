import { test, expect } from "bun:test";
import { valueForInputType } from "./input-value.mjs";

// 2026-10-31 (Brewline 4 proof run): a journey filled the order page's pickup field (an <input type="datetime-local">) with
// {{datetime+1 09:30}}, which expands to 2026-11-01T09:30:00+05:30. The browser accepts only 2026-11-01T09:30 in that field
// and refused the value ("Malformed value"), so a working page failed its test. A date, time or datetime-local field gets
// the same moment in the form the field takes, in local time.
test("a date or time field gets the value in the form it takes, in local time", () => {
  const zoned = new Date(2026, 10, 1, 9, 30);
  const iso = zoned.toISOString();
  expect(valueForInputType("datetime-local", iso)).toBe("2026-11-01T09:30");
  expect(valueForInputType("date", iso)).toBe("2026-11-01");
  expect(valueForInputType("time", iso)).toBe("09:30");
  expect(valueForInputType("datetime-local", "2026-11-01T09:30")).toBe("2026-11-01T09:30");
  expect(valueForInputType("text", iso)).toBe(iso);
  expect(valueForInputType("time", "soon")).toBe("soon");
  expect(valueForInputType(null, "Latte")).toBe("Latte");
});
