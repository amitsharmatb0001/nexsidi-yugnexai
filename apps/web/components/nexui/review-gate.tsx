"use client";

import { css, themeVars as theme } from "@yugnex/core";
import { useCallback, useMemo, useState, type ReactNode } from "react";

/* ------------------------------------------------------------------ *
 * Model
 * ------------------------------------------------------------------ */

/**
 * What a decision applies to. The four levels are hierarchical: deciding at
 * `document` implies every section, file, and hunk beneath it.
 */
export type ReviewScope = "document" | "section" | "file" | "hunk";

export type ReviewVerdict = "accepted" | "rejected" | "changes-requested";

export interface ReviewDecision {
  scope: ReviewScope;
  /** Identifies the target within its scope; the document scope uses "document". */
  id: string;
  verdict: ReviewVerdict;
  /** Required for "changes-requested" — a rejection with no reason is not actionable. */
  note?: string;
  at: number;
}

export type ReviewState = Record<string, ReviewDecision>;

/** Keys a decision by scope and id so a file and a hunk can't collide. */
export function decisionKey(scope: ReviewScope, id: string): string {
  return `${scope}:${id}`;
}

const SCOPE_RANK: Record<ReviewScope, number> = { document: 0, section: 1, file: 2, hunk: 3 };

export interface ResolveOptions {
  /** Ancestors from broadest to narrowest, e.g. [["section","auth"],["file","a.ts"]]. */
  ancestors?: Array<[ReviewScope, string]>;
}

/**
 * Resolves the verdict in force for a target.
 *
 * A decision on the target itself always wins; otherwise the *narrowest*
 * ancestor decision applies. That ordering is what makes "accept everything,
 * then reject this one hunk" behave the way a reviewer expects, rather than
 * the document-level accept overriding the specific rejection.
 */
export function resolveVerdict(
  state: ReviewState,
  scope: ReviewScope,
  id: string,
  options: ResolveOptions = {},
): { verdict: ReviewVerdict | undefined; inherited: boolean; from?: ReviewDecision } {
  const own = state[decisionKey(scope, id)];
  if (own) return { verdict: own.verdict, inherited: false, from: own };

  const ancestors = [...(options.ancestors ?? [])].sort(
    (a, b) => SCOPE_RANK[b[0]] - SCOPE_RANK[a[0]],
  );

  for (const [ancestorScope, ancestorId] of ancestors) {
    const decision = state[decisionKey(ancestorScope, ancestorId)];
    if (decision) return { verdict: decision.verdict, inherited: true, from: decision };
  }

  return { verdict: undefined, inherited: false };
}

/** Tracks review decisions. Controlled via `value`/`onChange`, or uncontrolled. */
export function useReviewState(initial: ReviewState = {}) {
  const [state, setState] = useState<ReviewState>(initial);

  const decide = useCallback((scope: ReviewScope, id: string, verdict: ReviewVerdict, note?: string) => {
    setState((prev) => ({
      ...prev,
      [decisionKey(scope, id)]: { scope, id, verdict, note, at: Date.now() },
    }));
  }, []);

  const clear = useCallback((scope: ReviewScope, id: string) => {
    setState((prev) => {
      const next = { ...prev };
      delete next[decisionKey(scope, id)];
      return next;
    });
  }, []);

  const reset = useCallback(() => setState({}), []);

  return { state, decide, clear, reset };
}

/* ------------------------------------------------------------------ *
 * Styles
 * ------------------------------------------------------------------ */

const rootVariantBase = {
  display: "flex",
  alignItems: "center",
  gap: theme.space[2],
  fontFamily: theme.fontFamily.sans,
} as const;

const barClass = css({
  ...rootVariantBase,
  flexWrap: "wrap",
  padding: `${theme.space[2]} ${theme.space[3]}`,
  borderRadius: theme.radius.md,
  border: `1px solid ${theme.color.border}`,
  backgroundColor: theme.color.card,
});

const inlineClass = css({ ...rootVariantBase });

const buttonBase = {
  display: "inline-flex",
  alignItems: "center",
  gap: theme.space[1],
  borderRadius: theme.radius.sm,
  border: `1px solid ${theme.color.border}`,
  backgroundColor: theme.color.background,
  color: theme.color.foreground,
  fontFamily: theme.fontFamily.sans,
  fontWeight: theme.fontWeight.medium,
  cursor: "pointer",
  transitionProperty: "background-color, border-color, color",
  transitionDuration: theme.duration.fast,
  "&:focus-visible": { outline: `2px solid ${theme.color.ring}`, outlineOffset: "1px" },
  "&:disabled": { opacity: 0.5, cursor: "not-allowed" },
} as const;

const acceptClass = css({
  ...buttonBase,
  height: "1.875rem",
  padding: `0 ${theme.space[2.5]}`,
  fontSize: theme.fontSize.xs,
  "&:hover:not(:disabled)": { borderColor: theme.color.success, color: theme.color.success },
  '&[aria-pressed="true"]': {
    backgroundColor: theme.color.success,
    borderColor: theme.color.success,
    color: theme.color.successForeground,
  },
});

const rejectClass = css({
  ...buttonBase,
  height: "1.875rem",
  padding: `0 ${theme.space[2.5]}`,
  fontSize: theme.fontSize.xs,
  "&:hover:not(:disabled)": { borderColor: theme.color.destructive, color: theme.color.destructive },
  '&[aria-pressed="true"]': {
    backgroundColor: theme.color.destructive,
    borderColor: theme.color.destructive,
    color: theme.color.destructiveForeground,
  },
});

const changesClass = css({
  ...buttonBase,
  height: "1.875rem",
  padding: `0 ${theme.space[2.5]}`,
  fontSize: theme.fontSize.xs,
  "&:hover:not(:disabled)": { borderColor: theme.color.warning, color: theme.color.warning },
  '&[aria-pressed="true"]': {
    backgroundColor: theme.color.warning,
    borderColor: theme.color.warning,
    color: theme.color.warningForeground,
  },
});

const labelClass = css({
  fontSize: theme.fontSize.sm,
  fontWeight: theme.fontWeight.medium,
  color: theme.color.foreground,
  marginRight: "auto",
});

const inheritedClass = css({
  fontSize: theme.fontSize.xs,
  color: theme.color.mutedForeground,
  fontStyle: "italic",
});

const noteFormClass = css({
  display: "flex",
  flexDirection: "column",
  gap: theme.space[2],
  width: "100%",
  marginTop: theme.space[2],
  paddingTop: theme.space[2],
  borderTop: `1px solid ${theme.color.border}`,
});

const noteInputClass = css({
  width: "100%",
  minHeight: "4rem",
  padding: theme.space[2],
  borderRadius: theme.radius.sm,
  border: `1px solid ${theme.color.input}`,
  backgroundColor: theme.color.background,
  color: theme.color.foreground,
  fontFamily: theme.fontFamily.sans,
  fontSize: theme.fontSize.sm,
  resize: "vertical",
  "&:focus-visible": {
    outline: "none",
    borderColor: theme.color.ring,
    boxShadow: `0 0 0 3px ${theme.color.accent}`,
  },
});

const noteActionsClass = css({ display: "flex", gap: theme.space[2], justifyContent: "flex-end" });

const submitClass = css({
  ...buttonBase,
  height: "1.875rem",
  padding: `0 ${theme.space[3]}`,
  fontSize: theme.fontSize.xs,
  backgroundColor: theme.color.primary,
  borderColor: theme.color.primary,
  color: theme.color.primaryForeground,
  "&:hover:not(:disabled)": { opacity: 0.92 },
});

const cancelClass = css({
  ...buttonBase,
  height: "1.875rem",
  padding: `0 ${theme.space[3]}`,
  fontSize: theme.fontSize.xs,
});

const noteShownClass = css({
  width: "100%",
  marginTop: theme.space[2],
  paddingTop: theme.space[2],
  borderTop: `1px solid ${theme.color.border}`,
  fontSize: theme.fontSize.sm,
  color: theme.color.mutedForeground,
  whiteSpace: "pre-wrap",
});

/* ------------------------------------------------------------------ *
 * Component
 * ------------------------------------------------------------------ */

export interface ReviewGateProps {
  scope: ReviewScope;
  /** Identifies the target within its scope. */
  id: string;
  /** Shown to the left of the controls, e.g. the file path or section title. */
  label?: ReactNode;
  /** Current decisions. Pass with `onDecide` for a controlled gate. */
  value?: ReviewState;
  onDecide?: (decision: ReviewDecision) => void;
  onClear?: (scope: ReviewScope, id: string) => void;
  /** Broader targets whose verdicts this one inherits when it has none of its own. */
  ancestors?: Array<[ReviewScope, string]>;
  /** `bar` draws a bordered surface; `inline` is bare, for embedding in a hunk header. */
  variant?: "bar" | "inline";
  disabled?: boolean;
  className?: string;
}

/**
 * The Accept / Reject / Request-changes control, operable at document,
 * section, file, or hunk granularity.
 *
 * Requesting changes opens a required note field: a rejection with no reason
 * gives the generating agent nothing to act on, so the submit stays disabled
 * until the reviewer writes something.
 */
export function ReviewGate({
  scope,
  id,
  label,
  value,
  onDecide,
  onClear,
  ancestors,
  variant = "bar",
  disabled = false,
  className,
}: ReviewGateProps) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");

  const state = value ?? {};
  const resolved = useMemo(
    () => resolveVerdict(state, scope, id, { ancestors }),
    [state, scope, id, ancestors],
  );

  const emit = (verdict: ReviewVerdict, withNote?: string) => {
    // Pressing the verdict already in force clears it, so a reviewer can undo
    // without a separate reset control.
    if (!resolved.inherited && resolved.verdict === verdict && verdict !== "changes-requested") {
      onClear?.(scope, id);
      return;
    }
    onDecide?.({ scope, id, verdict, note: withNote, at: Date.now() });
  };

  const submitNote = () => {
    const trimmed = note.trim();
    if (!trimmed) return;
    emit("changes-requested", trimmed);
    setNote("");
    setNoteOpen(false);
  };

  const rootClass = variant === "inline" ? inlineClass : barClass;
  const own = state[decisionKey(scope, id)];

  return (
    <div
      className={className ? `${rootClass} ${className}` : rootClass}
      role="group"
      aria-label={typeof label === "string" ? `Review ${label}` : `Review ${scope}`}
    >
      {label ? <span className={labelClass}>{label}</span> : null}

      {resolved.inherited && resolved.verdict ? (
        <span className={inheritedClass}>
          inherited: {VERDICT_LABEL[resolved.verdict]} from {resolved.from?.scope}
        </span>
      ) : null}

      <button
        type="button"
        className={acceptClass}
        aria-pressed={resolved.verdict === "accepted"}
        disabled={disabled}
        onClick={() => emit("accepted")}
      >
        <CheckIcon /> Accept
      </button>

      <button
        type="button"
        className={changesClass}
        aria-pressed={resolved.verdict === "changes-requested"}
        aria-expanded={noteOpen}
        disabled={disabled}
        onClick={() => setNoteOpen((open) => !open)}
      >
        <PencilIcon /> Request changes
      </button>

      <button
        type="button"
        className={rejectClass}
        aria-pressed={resolved.verdict === "rejected"}
        disabled={disabled}
        onClick={() => emit("rejected")}
      >
        <CrossIcon /> Reject
      </button>

      {noteOpen ? (
        <div className={noteFormClass}>
          <textarea
            className={noteInputClass}
            placeholder="What needs to change?"
            aria-label="Requested changes"
            value={note}
            autoFocus
            onChange={(event) => setNote(event.target.value)}
            onKeyDown={(event) => {
              // Ctrl/Cmd+Enter submits, matching every review textarea people
              // already use; plain Enter must still insert a newline.
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                submitNote();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setNoteOpen(false);
              }
            }}
          />
          <div className={noteActionsClass}>
            <button type="button" className={cancelClass} onClick={() => setNoteOpen(false)}>
              Cancel
            </button>
            <button type="button" className={submitClass} disabled={note.trim().length === 0} onClick={submitNote}>
              Send request
            </button>
          </div>
        </div>
      ) : null}

      {!noteOpen && own?.verdict === "changes-requested" && own.note ? (
        <p className={noteShownClass}>{own.note}</p>
      ) : null}
    </div>
  );
}

const VERDICT_LABEL: Record<ReviewVerdict, string> = {
  accepted: "accepted",
  rejected: "rejected",
  "changes-requested": "changes requested",
};

/* ------------------------------------------------------------------ *
 * Summary
 * ------------------------------------------------------------------ */

export interface ReviewSummaryProps {
  state: ReviewState;
  /** Every target expected to be reviewed, for an outstanding count. */
  expected?: Array<[ReviewScope, string]>;
  className?: string;
}

const summaryClass = css({
  display: "flex",
  alignItems: "center",
  gap: theme.space[3],
  fontFamily: theme.fontFamily.sans,
  fontSize: theme.fontSize.sm,
  color: theme.color.mutedForeground,
});

const countClass = css({ display: "inline-flex", alignItems: "center", gap: theme.space[1] });

/** A tally of decisions so far — pairs with a document-level ReviewGate. */
export function ReviewSummary({ state, expected, className }: ReviewSummaryProps) {
  const counts = useMemo(() => {
    const tally = { accepted: 0, rejected: 0, "changes-requested": 0 };
    for (const decision of Object.values(state)) tally[decision.verdict]++;
    return tally;
  }, [state]);

  const outstanding = expected
    ? expected.filter(([scope, id]) => !state[decisionKey(scope, id)]).length
    : undefined;

  return (
    <div className={className ? `${summaryClass} ${className}` : summaryClass}>
      <span className={countClass} style={{ color: theme.color.success }}>
        {counts.accepted} accepted
      </span>
      <span className={countClass} style={{ color: theme.color.warning }}>
        {counts["changes-requested"]} changes requested
      </span>
      <span className={countClass} style={{ color: theme.color.destructive }}>
        {counts.rejected} rejected
      </span>
      {outstanding !== undefined ? <span>{outstanding} awaiting review</span> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Icons
 * ------------------------------------------------------------------ */

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M2.5 6.5L4.75 8.75L9.5 3.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CrossIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M8.5 1.5l2 2-6 6-2.5.5.5-2.5 6-6z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}
