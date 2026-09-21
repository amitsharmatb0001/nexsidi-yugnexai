import { css, keyframes, themeVars as theme } from "@yugnex/core";
import { eyebrow, ground, signal } from "@/lib/design";

const sweepIn = keyframes({
  from: { opacity: 0, transform: "translateY(10px)" },
  to: { opacity: 1, transform: "translateY(0)" },
});

const spin = keyframes({
  from: { transform: "rotate(0deg)" },
  to: { transform: "rotate(360deg)" },
});

export const clone = {
  main: css({
    position: "relative",
    maxWidth: "720px",
    margin: "0 auto",
    padding: `${theme.space[8]} ${theme.space[5]} ${theme.space[16]}`,
  }),

  masthead: css({
    marginBottom: theme.space[6],
    animation: `${sweepIn} ${theme.duration.slow} ${theme.easing.decelerate} both`,
  }),

  eyebrow,

  title: css({
    margin: 0,
    marginTop: theme.space[2],
    fontFamily: "var(--nx-font-family-display)",
    fontSize: "28px",
    lineHeight: 1.1,
    fontWeight: theme.fontWeight.bold,
    letterSpacing: "-0.025em",
    color: theme.color.foreground,
  }),

  sub: css({
    marginTop: theme.space[2],
    fontSize: theme.fontSize.sm,
    color: theme.color.mutedForeground,
    maxWidth: "60ch",
  }),

  form: css({
    backgroundColor: ground.panel,
    border: `1px solid ${ground.seam}`,
    borderRadius: theme.radius.md,
    padding: theme.space[6],
    display: "flex",
    flexDirection: "column",
    gap: theme.space[5],
  }),

  field: css({
    display: "flex",
    flexDirection: "column",
    gap: theme.space[2],
  }),

  label: css({
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.color.foreground,
  }),

  hint: css({
    fontSize: "12px",
    color: theme.color.mutedForeground,
  }),

  input: css({
    backgroundColor: ground.raised,
    border: `1px solid ${ground.seam}`,
    borderRadius: theme.radius.sm,
    padding: `${theme.space[3]} ${theme.space[3]}`,
    color: theme.color.foreground,
    fontSize: theme.fontSize.sm,
    fontFamily: "inherit",
    outline: "none",
    "&:focus": { borderColor: signal.machineEdge },
    "&::placeholder": { color: theme.color.mutedForeground },
  }),

  textarea: css({
    backgroundColor: ground.raised,
    border: `1px solid ${ground.seam}`,
    borderRadius: theme.radius.sm,
    padding: theme.space[3],
    color: theme.color.foreground,
    fontSize: theme.fontSize.sm,
    fontFamily: "inherit",
    resize: "vertical",
    minHeight: "88px",
    outline: "none",
    "&:focus": { borderColor: signal.machineEdge },
    "&::placeholder": { color: theme.color.mutedForeground },
  }),

  select: css({
    backgroundColor: ground.raised,
    border: `1px solid ${ground.seam}`,
    borderRadius: theme.radius.sm,
    padding: theme.space[3],
    color: theme.color.foreground,
    fontSize: theme.fontSize.sm,
    fontFamily: "inherit",
    outline: "none",
  }),

  modeRow: css({
    display: "flex",
    gap: theme.space[2],
  }),

  modeBtn: css({
    flex: 1,
    padding: `${theme.space[3]} ${theme.space[3]}`,
    borderRadius: theme.radius.sm,
    border: `1px solid ${ground.seam}`,
    backgroundColor: "transparent",
    color: theme.color.mutedForeground,
    fontSize: theme.fontSize.sm,
    cursor: "pointer",
    textAlign: "center",
  }),

  modeBtnActive: css({
    borderColor: signal.machineEdge,
    backgroundColor: signal.machineDim,
    color: theme.color.foreground,
  }),

  submit: css({
    marginTop: theme.space[2],
    padding: `${theme.space[3]} ${theme.space[5]}`,
    borderRadius: theme.radius.sm,
    border: "none",
    backgroundColor: signal.human,
    color: ground.void,
    fontWeight: theme.fontWeight.medium,
    fontSize: theme.fontSize.sm,
    cursor: "pointer",
    "&:disabled": { opacity: 0.5, cursor: "not-allowed" },
  }),

  statusPanel: css({
    backgroundColor: ground.panel,
    border: `1px solid ${ground.seam}`,
    borderRadius: theme.radius.md,
    marginTop: theme.space[5],
    padding: theme.space[5],
  }),

  statusRow: css({
    display: "flex",
    alignItems: "center",
    gap: theme.space[3],
    marginBottom: theme.space[3],
  }),

  spinner: css({
    width: "14px",
    height: "14px",
    borderRadius: "50%",
    border: `2px solid ${ground.seam}`,
    borderTopColor: signal.machine,
    animation: `${spin} 0.8s linear infinite`,
  }),

  ok: css({ color: signal.ok, fontWeight: theme.fontWeight.medium }),
  fail: css({ color: signal.fail, fontWeight: theme.fontWeight.medium }),

  resultLine: css({
    fontSize: theme.fontSize.sm,
    color: theme.color.foreground,
    marginBottom: theme.space[2],
    lineHeight: 1.5,
  }),

  resultLabel: css({
    color: theme.color.mutedForeground,
    marginRight: theme.space[2],
  }),

  link: css({
    color: signal.machine,
    textDecoration: "underline",
  }),

  pre: css({
    fontFamily: theme.fontFamily.mono,
    fontSize: "12px",
    color: theme.color.mutedForeground,
    whiteSpace: "pre-wrap",
    marginTop: theme.space[2],
    lineHeight: 1.6,
  }),
};
