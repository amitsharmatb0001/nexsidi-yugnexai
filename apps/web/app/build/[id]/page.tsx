"use client";

// Nice-to-have #11: live pipeline status + agent health via WebSocket
import { useEffect, useState } from "react";

interface AgentHealth {
  type: "agent_health";
  ts: number;
  circuits: Record<string, "CLOSED" | "OPEN" | "HALF_OPEN">;
  rpm: Record<string, { tokens: number; utilizationPct: number }>;
}

const STATE_COLOR = {
  CLOSED: "bg-green-500",
  HALF_OPEN: "bg-yellow-500",
  OPEN: "bg-red-500",
} as const;

export default function BuildPage({ params }: { params: { id: string } }) {
  const [health, setHealth] = useState<AgentHealth | null>(null);
  const [wsStatus, setWsStatus] = useState<"connecting" | "open" | "closed">("connecting");

  useEffect(() => {
    const ws = new WebSocket(
      `${process.env.NEXT_PUBLIC_API_URL ?? "ws://localhost:8080"}/ws/agents`,
    );
    ws.onopen = () => setWsStatus("open");
    ws.onclose = () => setWsStatus("closed");
    ws.onmessage = (e) => {
      try {
        setHealth(JSON.parse(e.data as string) as AgentHealth);
      } catch { /* ignore parse errors */ }
    };
    return () => ws.close();
  }, []);

  return (
    <div className="max-w-4xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-2">Build #{params.id}</h1>
      <span className={`text-xs px-2 py-1 rounded ${wsStatus === "open" ? "bg-green-800" : "bg-gray-700"}`}>
        {wsStatus}
      </span>

      {health && (
        <div className="mt-8 grid grid-cols-2 gap-4">
          <div>
            <h2 className="font-semibold mb-3 text-gray-300">Circuit Breakers</h2>
            {Object.entries(health.circuits).map(([key, state]) => (
              <div key={key} className="flex items-center gap-3 mb-2">
                <span className={`w-2 h-2 rounded-full ${STATE_COLOR[state]}`} />
                <span className="text-sm font-mono text-gray-300">{key}</span>
                <span className="text-xs text-gray-500">{state}</span>
              </div>
            ))}
          </div>
          <div>
            <h2 className="font-semibold mb-3 text-gray-300">RPM Utilisation</h2>
            {Object.entries(health.rpm).map(([model, data]) => (
              <div key={model} className="mb-3">
                <div className="flex justify-between text-xs text-gray-400 mb-1">
                  <span className="font-mono">{model.split("/").pop()}</span>
                  <span>{data.utilizationPct}%</span>
                </div>
                <div className="h-1.5 bg-gray-800 rounded">
                  <div
                    className="h-full bg-indigo-500 rounded"
                    style={{ width: `${data.utilizationPct}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
