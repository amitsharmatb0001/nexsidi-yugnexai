"use client";

import { plan as s, methodColor } from "./PlanPreview.styles";

interface Task {
  description: string;
  outputFiles: string[];
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
    endpoints: Array<{ method: string; path: string; description: string }>;
  };
  dbSchema?: {
    tables: Array<{ name: string; fields: Array<{ name: string; type: string; primaryKey?: boolean }> }>;
  };
  // Public workstream labels below, never the internal agent names these
  // fields are keyed by — the confidentiality rule (CLAUDE.md) applies to
  // every label this component renders, not just server-emitted ones.
  aanyaTasks?: Task[];
  shubhamTasks?: Task[];
  pranavTasks?: Task[];
}

/** The real spec the pipeline is about to build against — rendered so the
 * approval gate shows what's actually being approved, not just a title. */
export default function PlanPreview({ plan }: { plan: BuildPlan }) {
  const design = plan.designBrief;
  const workstreams: Array<{ label: string; tasks: Task[] | undefined }> = [
    { label: "Frontend", tasks: plan.aanyaTasks },
    { label: "Backend", tasks: plan.shubhamTasks },
    { label: "Database", tasks: plan.pranavTasks },
  ];

  return (
    <div className={s.root}>
      <div>
        <div className={s.appName}>{plan.appName}</div>
        <div className={s.appDesc}>{plan.appDescription}</div>
      </div>

      {design && (design.mood || design.palette?.length) ? (
        <div className={s.section}>
          <div className={s.sectionTitle}>Design Direction</div>
          {design.mood && <div className={s.mood}>{design.mood}</div>}
          {design.palette?.length ? (
            <div className={s.palette}>
              {design.palette.map((c, i) => (
                <div key={i} className={s.swatch} title={c.hex}>
                  <span className={s.swatchDot} style={{ background: c.hex }} />
                  <span className={s.swatchLabel}>{c.name}</span>
                </div>
              ))}
            </div>
          ) : null}
          {design.typography && (design.typography.display || design.typography.body) && (
            <div className={s.typography}>
              {design.typography.display && <span>Display: {design.typography.display}</span>}
              {design.typography.body && <span>Body: {design.typography.body}</span>}
            </div>
          )}
        </div>
      ) : null}

      {plan.features?.length ? (
        <div className={s.section}>
          <div className={s.sectionTitle}>Features</div>
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
        </div>
      ) : null}

      {plan.apiContract?.endpoints?.length ? (
        <div className={s.section}>
          <div className={s.sectionTitle}>API Endpoints</div>
          {plan.apiContract.endpoints.map((ep, i) => (
            <div key={i} className={s.endpointRow}>
              <span className={s.methodBadge} style={{ color: methodColor(ep.method) }}>{ep.method}</span>
              <span className={s.endpointRoute}>{ep.path}</span>
            </div>
          ))}
        </div>
      ) : null}

      {plan.dbSchema?.tables?.length ? (
        <div className={s.section}>
          <div className={s.sectionTitle}>Database Tables</div>
          {plan.dbSchema.tables.map((t, i) => (
            <div key={i} className={s.table}>
              <span className={s.tableName}>{t.name}</span>
              <div className={s.fieldList}>
                {t.fields.map((f, j) => (
                  <span key={j} className={s.field}>
                    {f.primaryKey ? "🔑 " : ""}{f.name}: {f.type}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {workstreams.map(({ label, tasks }) => tasks?.length ? (
        <div key={label} className={s.section}>
          <div className={s.sectionTitle}>{label} Tasks</div>
          {tasks.map((t, i) => <div key={i} className={s.task}>{t.description}</div>)}
        </div>
      ) : null)}
    </div>
  );
}
