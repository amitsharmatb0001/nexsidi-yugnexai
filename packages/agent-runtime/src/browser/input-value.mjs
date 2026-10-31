// The value a form field takes (2026-10-31, Brewline 4 proof run): a test's {{datetime+N HH:MM}} expands to a full
// timestamp with the local offset, but <input type="datetime-local"> accepts only YYYY-MM-DDTHH:MM, "date" only YYYY-MM-DD
// and "time" only HH:MM. The same moment, in local time, in the form the field takes; anything else is left as written.
const pad = (n) => String(n).padStart(2, "0");

export function valueForInputType(type, value) {
  const t = String(type ?? "").toLowerCase();
  if (t !== "datetime-local" && t !== "date" && t !== "time") return value;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return value;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return t === "date" ? day : t === "time" ? time : `${day}T${time}`;
}
