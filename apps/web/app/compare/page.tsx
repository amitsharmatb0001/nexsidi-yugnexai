"use client";

// NexUI vs Tailwind — same NexSidi Build Status UI, two different stacks
// Left: @yugnex/nexui + NexuiSans (in-house everything)
// Right: Tailwind CSS + shadcn-style + Inter (third-party)

const PIPELINE = [
  { label: "Requirements", status: "done" },
  { label: "Spec",         status: "done" },
  { label: "Build",        status: "active" },
  { label: "QA",           status: "todo" },
  { label: "Deploy",       status: "todo" },
];

const LOGS = [
  { t: "12:34:01", level: "ok",   msg: "ProjectSpec locked — SHA-256: a4f2b9c1…" },
  { t: "12:34:03", level: "ok",   msg: "API contract generated (12 endpoints)" },
  { t: "12:34:05", level: "info", msg: "Generating frontend — Next.js 16.2 + TypeScript" },
  { t: "12:34:08", level: "dim",  msg: "  app/dashboard/page.tsx … created" },
  { t: "12:34:09", level: "dim",  msg: "  components/ui/task-list.tsx … created" },
  { t: "12:34:12", level: "warn", msg: "Layout matrix recompile triggered (theme change)" },
  { t: "12:34:14", level: "info", msg: "Running adversarial QA pass 1/3…" },
];

export default function ComparePage() {
  return (
    <>
      {/* ── Font declarations & NexUI token layer ──────────────────────── */}
      <style>{`
        @font-face {
          font-family: 'NexuiSans';
          font-weight: 400;
          font-display: swap;
          src: url('/nexui-fonts/NexuiSans-Regular.woff2') format('woff2');
        }
        @font-face {
          font-family: 'NexuiSans';
          font-weight: 500;
          font-display: swap;
          src: url('/nexui-fonts/NexuiSans-Medium.woff2') format('woff2');
        }
        @font-face {
          font-family: 'NexuiSans';
          font-weight: 700;
          font-display: swap;
          src: url('/nexui-fonts/NexuiSans-Bold.woff2') format('woff2');
        }
        @font-face {
          font-family: 'NexuiMono';
          font-weight: 400;
          font-display: swap;
          src: url('/nexui-fonts/NexuiMono-Regular.woff2') format('woff2');
        }

        /* ── NexUI design tokens ── */
        .nx {
          --bg:        #0D1117;
          --surface:   #161B22;
          --elevated:  #1C2128;
          --overlay:   #22272E;
          --border:    rgba(255,255,255,0.08);
          --border-hi: rgba(255,255,255,0.16);
          --text:      #E6EDF3;
          --text2:     #C9D1D9;
          --text3:     #8B949E;
          --text4:     #484F58;
          --accent:    #2563EB;
          --ok:        #3FB950;
          --warn:      #D29922;
          --err:       #F85149;
          background: var(--bg);
          color: var(--text);
          font-family: 'NexuiSans', system-ui, sans-serif;
          font-size: 13px;
          line-height: 1.5;
        }

        /* ── NexUI components ── */
        .nx-panel {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 8px;
        }
        .nx-panel-elevated {
          background: var(--elevated);
          border: 1px solid var(--border);
          border-radius: 8px;
        }
        .nx-nav {
          background: var(--bg);
          border-bottom: 1px solid var(--border);
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 20px;
          height: 48px;
        }
        .nx-logo {
          display: flex;
          align-items: center;
          gap: 8px;
          font-weight: 700;
          font-size: 14px;
          letter-spacing: -0.01em;
          color: var(--text);
        }
        .nx-logo-mark {
          width: 24px; height: 24px;
          background: var(--accent);
          border-radius: 5px;
          display: flex; align-items: center; justify-content: center;
          font-size: 11px; font-weight: 700; color: white;
        }
        .nx-dot {
          width: 7px; height: 7px;
          border-radius: 50%;
          background: var(--ok);
          box-shadow: 0 0 6px var(--ok);
        }
        .nx-status-row {
          display: flex; align-items: center; gap: 6px;
          font-size: 11px; color: var(--text3);
          font-family: 'NexuiMono', monospace;
        }
        .nx-badge {
          display: inline-flex; align-items: center; gap: 5px;
          font-size: 11px; font-weight: 500;
          padding: 3px 8px; border-radius: 4px;
          font-family: 'NexuiMono', monospace;
          letter-spacing: 0.02em;
        }
        .nx-badge-ok   { background:rgba(63,185,80,.12);  color:#3FB950; border:1px solid rgba(63,185,80,.25); }
        .nx-badge-on   { background:rgba(37,99,235,.15);  color:#60A5FA; border:1px solid rgba(37,99,235,.30); }
        .nx-badge-warn { background:rgba(210,153,34,.12); color:#D29922; border:1px solid rgba(210,153,34,.25); }
        .nx-badge-off  { background:rgba(72,79,88,.12);   color:#484F58; border:1px solid rgba(72,79,88,.20); }
        .nx-btn-p {
          background: var(--accent); color: white;
          border: none; border-radius: 6px;
          padding: 7px 16px; font-family: inherit;
          font-size: 13px; font-weight: 500; cursor: pointer;
          transition: opacity 120ms;
        }
        .nx-btn-p:hover { opacity: 0.85; }
        .nx-btn-g {
          background: transparent; color: var(--text3);
          border: 1px solid var(--border); border-radius: 6px;
          padding: 7px 16px; font-family: inherit;
          font-size: 13px; cursor: pointer;
          transition: border-color 120ms, color 120ms;
        }
        .nx-btn-g:hover { border-color: var(--border-hi); color: var(--text); }
        .nx-track { background: var(--elevated); border-radius: 2px; height: 3px; overflow: hidden; }
        .nx-fill  { height: 100%; border-radius: 2px; background: var(--accent); }
        .nx-log {
          font-family: 'NexuiMono', 'Cascadia Code', monospace;
          font-size: 11px; line-height: 1.65;
          color: var(--text3);
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 6px; padding: 10px 12px;
        }
        .nx-log .ok   { color: #3FB950; }
        .nx-log .info { color: #60A5FA; }
        .nx-log .warn { color: #D29922; }
        .nx-log .dim  { color: var(--text4); }
        .nx-sep { border: none; border-top: 1px solid var(--border); margin: 0; }
        .nx-step {
          display: flex; flex-direction: column; align-items: center; gap: 4px;
          font-size: 11px; font-family: 'NexuiMono', monospace;
        }
        .nx-step-dot { width: 8px; height: 8px; border-radius: 50%; }
        .nx-pipe { flex: 1; height: 1px; background: var(--border); margin-top: -12px; }

        /* ── Tailwind-mimic tokens (right side) ── */
        .tw {
          background: #09090b; color: #fafafa;
          font-family: 'Inter', system-ui, -apple-system, sans-serif;
          font-size: 14px; line-height: 1.5;
        }
        .tw-card {
          background: #18181b;
          border: 1px solid #27272a;
          border-radius: 12px;
        }
        .tw-nav {
          background: rgba(9,9,11,0.8);
          backdrop-filter: blur(12px);
          border-bottom: 1px solid #27272a;
          display: flex; align-items: center;
          justify-content: space-between;
          padding: 0 20px; height: 52px;
        }
        .tw-logo {
          display: flex; align-items: center; gap: 8px;
          font-weight: 600; font-size: 15px;
        }
        .tw-logo-mark {
          width: 26px; height: 26px;
          background: linear-gradient(135deg,#6366f1,#3b82f6);
          border-radius: 6px;
          display: flex; align-items: center; justify-content: center;
          font-size: 11px; font-weight: 700; color: white;
        }
        .tw-dot {
          width: 8px; height: 8px;
          border-radius: 9999px;
          background: #22c55e;
        }
        .tw-status-row {
          display: flex; align-items: center; gap: 6px;
          font-size: 12px; color: #71717a;
        }
        .tw-badge {
          display: inline-flex; align-items: center; gap: 4px;
          font-size: 12px; font-weight: 500;
          padding: 2px 10px; border-radius: 9999px;
        }
        .tw-badge-ok   { background:rgba(34,197,94,.1);  color:#22c55e; }
        .tw-badge-on   { background:rgba(99,102,241,.1); color:#818cf8; }
        .tw-badge-warn { background:rgba(234,179,8,.1);  color:#eab308; }
        .tw-badge-off  { background:rgba(113,113,122,.1);color:#71717a; }
        .tw-btn-p {
          background: #4f46e5; color: white;
          border: none; border-radius: 8px;
          padding: 8px 18px; font-family: inherit;
          font-size: 14px; font-weight: 500; cursor: pointer;
        }
        .tw-btn-g {
          background: transparent; color: #a1a1aa;
          border: 1px solid #27272a; border-radius: 8px;
          padding: 8px 18px; font-family: inherit;
          font-size: 14px; cursor: pointer;
        }
        .tw-track {
          background: #27272a; border-radius: 9999px;
          height: 6px; overflow: hidden;
        }
        .tw-fill {
          height: 100%; border-radius: 9999px;
          background: linear-gradient(90deg,#4f46e5,#7c3aed);
        }
        .tw-log {
          font-family: 'SF Mono','Fira Code', monospace;
          font-size: 12px; line-height: 1.7;
          color: #52525b;
          background: #09090b;
          border: 1px solid #27272a;
          border-radius: 8px; padding: 12px;
        }
        .tw-log .ok   { color: #22c55e; }
        .tw-log .info { color: #818cf8; }
        .tw-log .warn { color: #eab308; }
        .tw-log .dim  { color: #3f3f46; }
        .tw-sep { border:none; border-top:1px solid #27272a; margin:0; }

        /* ── Layout ── */
        * { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { height: 100%; }
        .compare-wrap { display: grid; grid-template-columns: 1fr 1fr; min-height: 100vh; }
        .col { display: flex; flex-direction: column; min-height: 100vh; }
        .banner {
          padding: 6px 20px;
          font-size: 11px;
          font-weight: 500;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          text-align: center;
        }
        .banner-nx { background: #0D1117; color: #2563EB; border-bottom: 1px solid rgba(37,99,235,0.3); font-family: 'NexuiMono', monospace; }
        .banner-tw { background: #09090b; color: #6366f1; border-bottom: 1px solid rgba(99,102,241,0.3); }
        .divider { width: 1px; background: #333; }
      `}</style>

      <div className="compare-wrap">

        {/* ══════════════════════════════════════════════════════════════
            LEFT — @yugnex/nexui  +  NexuiSans (in-house)
        ══════════════════════════════════════════════════════════════ */}
        <div className="col nx">

          {/* Label */}
          <div className="banner banner-nx">@yugnex/nexui · NexuiSans · NexuiMono · in-house fonts</div>

          {/* Nav */}
          <nav className="nx-nav">
            <div className="nx-logo">
              <div className="nx-logo-mark">NX</div>
              NexSidi
            </div>
            <div className="nx-status-row">
              <div className="nx-dot" />
              system operational
            </div>
          </nav>

          {/* Body */}
          <div style={{ flex: 1, padding: "20px", display: "flex", flexDirection: "column", gap: "14px" }}>

            {/* Project header */}
            <div className="nx-panel" style={{ padding: "16px 18px" }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.01em", marginBottom: 4 }}>
                    Task Manager App
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text3)", fontFamily: "'NexuiMono', monospace" }}>
                    proj_4a8f21 · requested 2 min ago
                  </div>
                </div>
                <span className="nx-badge nx-badge-on">▶ BUILDING</span>
              </div>
              <hr className="nx-sep" style={{ margin: "12px 0" }} />
              {/* Progress */}
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 11, color: "var(--text3)" }}>
                <span>Overall progress</span>
                <span style={{ fontFamily: "'NexuiMono', monospace" }}>68%</span>
              </div>
              <div className="nx-track">
                <div className="nx-fill" style={{ width: "68%" }} />
              </div>
            </div>

            {/* Pipeline */}
            <div className="nx-panel" style={{ padding: "14px 18px" }}>
              <div style={{ fontSize: 11, fontWeight: 500, color: "var(--text3)", marginBottom: 12, fontFamily: "'NexuiMono', monospace", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                Pipeline
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
                {PIPELINE.map((s, i) => (
                  <>
                    <div key={s.label} className="nx-step">
                      <div
                        className="nx-step-dot"
                        style={{
                          background: s.status === "done" ? "var(--ok)" : s.status === "active" ? "var(--accent)" : "var(--text4)",
                          boxShadow: s.status === "active" ? "0 0 8px var(--accent)" : "none",
                        }}
                      />
                      <span style={{ color: s.status === "done" ? "var(--ok)" : s.status === "active" ? "var(--text)" : "var(--text4)", fontSize: 10, fontFamily: "'NexuiMono', monospace", marginTop: 2 }}>
                        {s.label}
                      </span>
                    </div>
                    {i < PIPELINE.length - 1 && (
                      <div className="nx-pipe" key={`pipe-${i}`} />
                    )}
                  </>
                ))}
              </div>
            </div>

            {/* Stage detail */}
            <div className="nx-panel" style={{ padding: "14px 18px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 500 }}>Build stage</div>
                <span className="nx-badge nx-badge-on" style={{ fontSize: 10 }}>pass 1/3</span>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span className="nx-badge nx-badge-ok">✓ Express backend</span>
                <span className="nx-badge nx-badge-on">▶ Next.js frontend</span>
                <span className="nx-badge nx-badge-off">○ DB migrations</span>
              </div>
            </div>

            {/* Log */}
            <div className="nx-panel" style={{ padding: "14px 18px", flex: 1 }}>
              <div style={{ fontSize: 11, fontWeight: 500, color: "var(--text3)", marginBottom: 10, fontFamily: "'NexuiMono', monospace", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                Activity
              </div>
              <div className="nx-log">
                {LOGS.map((l, i) => (
                  <div key={i}>
                    <span className="dim">[{l.t}]</span>{" "}
                    <span className={l.level === "ok" ? "ok" : l.level === "info" ? "info" : l.level === "warn" ? "warn" : "dim"}>
                      {l.level === "ok" ? "✓" : l.level === "info" ? "▶" : l.level === "warn" ? "⚠" : " "}&nbsp;
                    </span>
                    {l.msg}
                  </div>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", paddingBottom: 4 }}>
              <button className="nx-btn-g">Cancel Build</button>
              <button className="nx-btn-p">View Details →</button>
            </div>

            {/* Font specimen */}
            <div className="nx-panel-elevated" style={{ padding: "12px 18px" }}>
              <div style={{ fontSize: 10, color: "var(--text4)", marginBottom: 8, fontFamily: "'NexuiMono', monospace", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                NexuiSans specimen
              </div>
              <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em", marginBottom: 2 }}>
                AaBbCc 0123456789
              </div>
              <div style={{ fontSize: 13, fontWeight: 400, color: "var(--text2)" }}>
                The quick brown fox jumps over the lazy dog.
              </div>
              <div style={{ fontSize: 11, fontFamily: "'NexuiMono', monospace", color: "var(--text3)", marginTop: 6 }}>
                NexuiMono: const sdk = new AnthropicSDK();
              </div>
            </div>
          </div>
        </div>

        {/* Divider */}
        <div className="divider" />

        {/* ══════════════════════════════════════════════════════════════
            RIGHT — Tailwind CSS  +  Inter (Google Fonts / system)
        ══════════════════════════════════════════════════════════════ */}
        <div className="col tw">

          {/* Label */}
          <div className="banner banner-tw">Tailwind CSS · shadcn/ui style · Inter · third-party</div>

          {/* Nav */}
          <nav className="tw-nav">
            <div className="tw-logo">
              <div className="tw-logo-mark">NS</div>
              NexSidi
            </div>
            <div className="tw-status-row">
              <div className="tw-dot" />
              <span>Operational</span>
            </div>
          </nav>

          {/* Body */}
          <div style={{ flex: 1, padding: "20px", display: "flex", flexDirection: "column", gap: "14px" }}>

            {/* Project header */}
            <div className="tw-card" style={{ padding: "16px 18px" }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
                    Task Manager App
                  </div>
                  <div style={{ fontSize: 12, color: "#71717a" }}>
                    proj_4a8f21 · requested 2 min ago
                  </div>
                </div>
                <span className="tw-badge tw-badge-on">Building</span>
              </div>
              <hr className="tw-sep" style={{ margin: "12px 0" }} />
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: 13, color: "#71717a" }}>
                <span>Overall progress</span>
                <span>68%</span>
              </div>
              <div className="tw-track">
                <div className="tw-fill" style={{ width: "68%" }} />
              </div>
            </div>

            {/* Pipeline */}
            <div className="tw-card" style={{ padding: "14px 18px" }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: "#71717a", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Pipeline
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
                {PIPELINE.map((s, i) => (
                  <>
                    <div key={s.label} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                      <div style={{
                        width: 10, height: 10, borderRadius: "50%",
                        background: s.status === "done" ? "#22c55e" : s.status === "active" ? "#818cf8" : "#3f3f46",
                        boxShadow: s.status === "active" ? "0 0 8px #818cf8" : "none",
                      }} />
                      <span style={{ fontSize: 11, color: s.status === "done" ? "#22c55e" : s.status === "active" ? "#e4e4e7" : "#3f3f46", marginTop: 2 }}>
                        {s.label}
                      </span>
                    </div>
                    {i < PIPELINE.length - 1 && (
                      <div key={`p${i}`} style={{ flex: 1, height: 1, background: "#27272a", marginTop: -13 }} />
                    )}
                  </>
                ))}
              </div>
            </div>

            {/* Stage detail */}
            <div className="tw-card" style={{ padding: "14px 18px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>Build stage</div>
                <span className="tw-badge tw-badge-on" style={{ fontSize: 11 }}>pass 1/3</span>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span className="tw-badge tw-badge-ok">✓ Express backend</span>
                <span className="tw-badge tw-badge-on">▶ Next.js frontend</span>
                <span className="tw-badge tw-badge-off">○ DB migrations</span>
              </div>
            </div>

            {/* Log */}
            <div className="tw-card" style={{ padding: "14px 18px", flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: "#71717a", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Activity
              </div>
              <div className="tw-log">
                {LOGS.map((l, i) => (
                  <div key={i}>
                    <span style={{ color: "#3f3f46" }}>[{l.t}]</span>{" "}
                    <span className={l.level === "ok" ? "ok" : l.level === "info" ? "info" : l.level === "warn" ? "warn" : "dim"}>
                      {l.level === "ok" ? "✓" : l.level === "info" ? "▶" : l.level === "warn" ? "⚠" : " "}&nbsp;
                    </span>
                    {l.msg}
                  </div>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", paddingBottom: 4 }}>
              <button className="tw-btn-g">Cancel Build</button>
              <button className="tw-btn-p">View Details →</button>
            </div>

            {/* Font specimen */}
            <div style={{ background: "#18181b", border: "1px solid #27272a", borderRadius: 12, padding: "12px 18px" }}>
              <div style={{ fontSize: 11, color: "#52525b", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                Inter (system / Google Fonts) specimen
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em", marginBottom: 2 }}>
                AaBbCc 0123456789
              </div>
              <div style={{ fontSize: 14, color: "#a1a1aa" }}>
                The quick brown fox jumps over the lazy dog.
              </div>
              <div style={{ fontSize: 12, fontFamily: "monospace", color: "#71717a", marginTop: 6 }}>
                system-mono: const sdk = new AnthropicSDK();
              </div>
            </div>
          </div>
        </div>

      </div>
    </>
  );
}
