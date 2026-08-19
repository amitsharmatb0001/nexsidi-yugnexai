"use client";

import { plan as s, methodColor } from "./PlanPreview.styles";

interface Task {
  description: string;
  outputFiles: string[];
}

interface DbField {
  name: string;
  type: string;
  nullable?: boolean;
  primaryKey?: boolean;
  default?: string | null;
}

export interface BuildPlan {
  appName: string;
  appDescription: string;
  designBrief?: {
    mood?: string;
    palette?: Array<{ name: string; hex: string }>;
    typography?: { display?: string; body?: string };
    layoutConcept?: string;
  };
  features?: Array<{ name: string; description: string; userStories?: string[] }>;
  apiContract?: {
    baseUrl?: string;
    endpoints: Array<{
      method: string;
      path: string;
      description: string;
      auth?: boolean;
      requestType?: string;
      responseType?: string;
      errorCodes?: number[];
    }>;
  };
  // Real pipeline runs have produced both { name, fields } and
  // { tableName, columns } for the same dbSchema.tables shape across
  // different builds — Arjun's output isn't schema-locked on this field
  // naming. Both are accepted and normalized below rather than assuming
  // either is authoritative.
  dbSchema?: {
    tables: Array<{
      name?: string;
      tableName?: string;
      fields?: Array<DbField>;
      columns?: Array<DbField>;
    }>;
  };
  // Public workstream labels below, never the internal agent names these
  // fields are keyed by — the confidentiality rule (CLAUDE.md) applies to
  // every label this component renders, not just server-emitted ones.
  aanyaTasks?: Task[];
  shubhamTasks?: Task[];
  pranavTasks?: Task[];
}

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className={s.section}>
      <div className={s.sectionHead}>
        <span className={s.sectionNum}>{String(n).padStart(2, "0")}</span>
        <span className={s.sectionTitle}>{title}</span>
      </div>
      {children}
    </div>
  );
}

/** The real spec the pipeline is about to build against — rendered as an
 * actual document (numbered sections, real tables) so the approval gate
 * shows what's being approved, not a compact summary of it. */
export default function PlanPreview({ plan }: { plan: BuildPlan }) {
  const design = plan.designBrief;
  const workstreams: Array<{ label: string; tasks: Task[] | undefined }> = [
    { label: "Frontend", tasks: plan.aanyaTasks },
    { label: "Backend", tasks: plan.shubhamTasks },
    { label: "Database", tasks: plan.pranavTasks },
  ].filter((w) => w.tasks?.length);

  let n = 0;

  return (
    <div className={s.root}>
      <div className={s.header}>
        <div className={s.appName}>{plan.appName}</div>
        <div className={s.appDesc}>{plan.appDescription}</div>
      </div>

      {design && (design.mood || design.palette?.length || design.layoutConcept) ? (
        <Section n={++n} title="Design Direction">
          {design.mood && <p className={s.prose}>{design.mood}</p>}
          {design.palette?.length ? (
            <div className={s.palette}>
              {design.palette.map((c, i) => (
                <div key={i} className={s.swatch}>
                  <span className={s.swatchDot} style={{ background: c.hex }} />
                  <span className={s.swatchText}>
                    <span className={s.swatchName}>{c.name}</span>
                    <span className={s.swatchHex}>{c.hex}</span>
                  </span>
                </div>
              ))}
            </div>
          ) : null}
          {design.typography && (design.typography.display || design.typography.body) && (
            <div className={s.typography}>
              {design.typography.display && (
                <span><span className={s.typographyLabel}>Display</span><span className={s.typographyValue}>{design.typography.display}</span></span>
              )}
              {design.typography.body && (
                <span><span className={s.typographyLabel}>Body</span><span className={s.typographyValue}>{design.typography.body}</span></span>
              )}
            </div>
          )}
          {design.layoutConcept && <p className={s.prose} style={{ marginTop: "16px" }}>{design.layoutConcept}</p>}
        </Section>
      ) : null}

      {plan.features?.length ? (
        <Section n={++n} title="Features">
          {plan.features.map((f, i) => (
            <div key={i} className={s.feature}>
              <div className={s.featureName}>{f.name}</div>
              <div className={s.featureDesc}>{f.description}</div>
              {f.userStories?.length ? (
                <ul className={s.storyList}>
                  {f.userStories.map((story, j) => <li key={j} className={s.story}>{story}</li>)}
                </ul>
              ) : null}
            </div>
          ))}
        </Section>
      ) : null}

      {plan.apiContract?.endpoints?.length ? (
        <Section n={++n} title="API Contract">
          {plan.apiContract.baseUrl && <span className={s.baseUrl}>{plan.apiContract.baseUrl}</span>}
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th className={s.th}>Method</th>
                  <th className={s.th}>Path</th>
                  <th className={s.th}>Description</th>
                  <th className={s.th}>Auth</th>
                </tr>
              </thead>
              <tbody>
                {plan.apiContract.endpoints.map((ep, i) => (
                  <tr key={i}>
                    <td className={s.td}><span className={s.methodBadge} style={{ color: methodColor(ep.method) }}>{ep.method}</span></td>
                    <td className={`${s.td} ${s.mono}`}>{ep.path}</td>
                    <td className={s.td}>{ep.description}</td>
                    <td className={s.td}>
                      <span className={ep.auth ? s.authYes : s.authNo}>{ep.auth ? "Required" : "Public"}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      ) : null}

      {plan.dbSchema?.tables?.length ? (
        <Section n={++n} title="Database Schema">
          {plan.dbSchema.tables.map((t, i) => {
            const tableName = t.name ?? t.tableName ?? "table";
            const fields = t.fields ?? t.columns ?? [];
            return (
              <div key={i} className={s.tableWrap}>
                <div className={s.tableName}>{tableName}</div>
                <table className={s.table}>
                  <thead>
                    <tr>
                      <th className={s.th}>Field</th>
                      <th className={s.th}>Type</th>
                      <th className={s.th}>Nullable</th>
                      <th className={s.th}>Default</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fields.map((f, j) => (
                      <tr key={j}>
                        <td className={`${s.td} ${s.mono}`}>
                          {f.primaryKey && <span className={s.keyIcon}>🔑</span>}{f.name}
                        </td>
                        <td className={`${s.td} ${s.mono}`}>{f.type}</td>
                        <td className={s.td}>{f.nullable ? "yes" : "no"}</td>
                        <td className={`${s.td} ${s.mono}`}>{f.default ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </Section>
      ) : null}

      {workstreams.length ? (
        <Section n={++n} title="Build Plan">
          {workstreams.map(({ label, tasks }) => (
            <div key={label} className={s.taskGroup}>
              <div className={s.taskGroupTitle}>{label}</div>
              {tasks!.map((t, i) => (
                <div key={i} className={s.task}>
                  <div className={s.taskDesc}>{t.description}</div>
                  {t.outputFiles?.length ? (
                    <div className={s.taskFiles}>
                      {t.outputFiles.map((f, j) => <span key={j} className={s.taskFile}>{f}</span>)}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ))}
        </Section>
      ) : null}
    </div>
  );
}
