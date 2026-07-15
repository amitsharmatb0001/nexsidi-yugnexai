export type BooleanAttributeHost = Pick<HTMLElement, "setAttribute" | "removeAttribute">;

export function syncBooleanAttribute(
  host: BooleanAttributeHost | null,
  name: string,
  enabled: boolean | undefined,
): void {
  if (!host) return;
  if (enabled) host.setAttribute(name, "");
  else host.removeAttribute(name);
}
