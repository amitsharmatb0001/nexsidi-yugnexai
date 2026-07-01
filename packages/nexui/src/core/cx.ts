// @yugnex/nexui — Class Name Utility
// Zero dependencies. Replaces clsx / classnames.
// cx("a", false && "b", undefined, "c") → "a c"
// cx({ active: true, disabled: false }) → "active"

type CxArg =
  | string
  | number
  | boolean
  | null
  | undefined
  | CxArg[]
  | Record<string, boolean | undefined | null>;

export function cx(...args: CxArg[]): string {
  const classes: string[] = [];

  for (const arg of args) {
    if (!arg) continue;

    if (typeof arg === "string" || typeof arg === "number") {
      classes.push(String(arg));
      continue;
    }

    if (Array.isArray(arg)) {
      const inner = cx(...arg);
      if (inner) classes.push(inner);
      continue;
    }

    if (typeof arg === "object") {
      for (const [key, value] of Object.entries(arg)) {
        if (value) classes.push(key);
      }
    }
  }

  return classes.join(" ");
}

/** Variant helper — picks one class from a map based on a key.
 *  Useful for component variant props without template literals. */
export function cv<T extends string>(
  map: Record<T, string>,
  variant: T,
  fallback = ""
): string {
  return map[variant] ?? fallback;
}
