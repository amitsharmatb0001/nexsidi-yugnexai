"use client";

import { useEffect, useRef, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

interface StageEvent {
  type: "stage" | "ping" | "waiting" | "complete";
  stage?: string;
  message?: string;
}

const STAGE_ORDER = [
  "spec", "decompose", "generate", "qa", "live_test", "deliver", "done",
];

const STAGE_MESSAGES: Record<string, string> = {
  spec:       "Getting started on your app...",
  decompose:  "Planning out the build...",
  generate:   "Writing your code. This usually takes 2-4 minutes.",
  qa:         "Running quality checks...",
  live_test:  "Testing the live app...",
  deliver:    "Almost done — packaging everything up.",
  done:       "Your app is ready!",
};

function StageRow({ stage, current }: { stage: string; current: string }) {
  const idx    = STAGE_ORDER.indexOf(stage);
  const curIdx = STAGE_ORDER.indexOf(current);
  const done   = idx < curIdx || current === "done";
  const active = stage === current && current !== "done";

  return (
    <div className={`flex items-start gap-3 py-2.5 transition-opacity ${
      active ? "opacity-100" : done ? "opacity-70" : "opacity-30"
    }`}>
      <div className={`mt-0.5 w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
        done   ? "bg-green-600" :
        active ? "bg-indigo-500 animate-pulse" :
                 "bg-gray-700"
      }`}>
        {done && (
          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        )}
        {active && <span className="w-2 h-2 rounded-full bg-white" />}
      </div>
      <p className={`text-sm ${active ? "text-white font-medium" : "text-gray-400"}`}>
        {STAGE_MESSAGES[stage] ?? stage}
      </p>
    </div>
  );
}

export default function BuildPage({ params }: { params: { id: string } }) {
  const [currentStage, setCurrentStage] = useState("spec");
  const [complete, setComplete]         = useState(false);
  const [appUrl, setAppUrl]             = useState<string | null>(null);
  const [githubRepo, setGithubRepo]     = useState<string | null>(null);
  const esRef                           = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource(`${API}/api/pipeline/${params.id}/status`);
    esRef.current = es;

    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data as string) as StageEvent;
        if (event.type === "stage" && event.stage) setCurrentStage(event.stage);
        if (event.type === "complete") {
          setComplete(true);
          es.close();
          fetch(`${API}/api/pipeline/${params.id}`)
            .then((r) => r.json())
            .then((data: { appUrl?: string; githubRepo?: string }) => {
              if (data.appUrl)    setAppUrl(data.appUrl);
              if (data.githubRepo) setGithubRepo(data.githubRepo);
            })
            .catch(() => {});
        }
      } catch { /* ignore */ }
    };

    return () => es.close();
  }, [params.id]);

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-xl mx-auto px-6 py-16">
        <a href="/" className="text-sm text-gray-500 hover:text-gray-300 transition">← Back</a>

        <h1 className="text-2xl font-bold mt-6 mb-1">
          {complete ? "Your app is ready" : "Building your app"}
        </h1>
        <p className="text-gray-400 text-sm mb-10">
          {complete
            ? "Everything is set up and running."
            : "This usually takes 5-10 minutes. You can close this tab."}
        </p>

        {/* Stage progress */}
        {!complete && (
          <div className="bg-gray-900 rounded-2xl px-6 py-2 mb-8 border border-gray-800">
            {STAGE_ORDER.map((s) => (
              <StageRow key={s} stage={s} current={currentStage} />
            ))}
          </div>
        )}

        {/* Completion card */}
        {complete && (
          <div className="bg-gray-900 rounded-2xl px-6 py-6 border border-green-800 space-y-5">
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-full bg-green-600 flex items-center justify-center">
                <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <span className="text-green-400 text-sm font-medium">Build complete</span>
            </div>

            {appUrl && (
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Your app</p>
                <a href={appUrl} target="_blank" rel="noopener noreferrer"
                   className="text-indigo-400 hover:text-indigo-300 font-mono text-sm">
                  {appUrl}
                </a>
              </div>
            )}

            {githubRepo && (
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Source code</p>
                <a href={githubRepo} target="_blank" rel="noopener noreferrer"
                   className="text-indigo-400 hover:text-indigo-300 font-mono text-sm">
                  {githubRepo}
                </a>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
