/**
 * 2026-10-13 (Amit): for now the product shows Express Build only. Signing in
 * or up lands on it, and "new app from scratch" is hidden until it is switched
 * back on. The from-scratch pages and APIs are untouched — set
 * NEXT_PUBLIC_FROM_SCRATCH=1 to bring the entry points back.
 */
export const POST_AUTH_PATH = "/dashboard/express-build";

export function fromScratchEnabled(env: { NEXT_PUBLIC_FROM_SCRATCH?: string }): boolean {
  return env.NEXT_PUBLIC_FROM_SCRATCH === "1";
}

// Referenced by its literal name so Next inlines it into the client bundle.
export const FROM_SCRATCH_ENABLED = fromScratchEnabled({
  NEXT_PUBLIC_FROM_SCRATCH: process.env.NEXT_PUBLIC_FROM_SCRATCH,
});
