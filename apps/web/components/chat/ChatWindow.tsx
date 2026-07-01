"use client";

import { useEffect, useRef, useState } from "react";
import { nanoid } from "nanoid";

interface Message {
  role: "user" | "assistant";
  content: string;
  ts: number;
}

interface BuildStatus {
  projectId: string;
  phase: string;
}

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

// Persist sessionId across page refreshes
function getSessionId(): string {
  if (typeof window === "undefined") return nanoid();
  const stored = sessionStorage.getItem("nexsidi_session");
  if (stored) return stored;
  const fresh = nanoid();
  sessionStorage.setItem("nexsidi_session", fresh);
  return fresh;
}

export function ChatWindow() {
  const [messages, setMessages]     = useState<Message[]>([]);
  const [input, setInput]           = useState("");
  const [streaming, setStreaming]   = useState(false);
  const [build, setBuild]           = useState<BuildStatus | null>(null);
  const [sessionId]                 = useState(getSessionId);
  const bottomRef                   = useRef<HTMLDivElement>(null);
  const inputRef                    = useRef<HTMLTextAreaElement>(null);

  // Load existing session on mount
  useEffect(() => {
    fetch(`${API}/api/chat/${sessionId}`)
      .then((r) => r.json())
      .then((data: { messages: Message[]; phase: string; projectId: string | null }) => {
        if (data.messages.length) setMessages(data.messages);
        if (data.projectId) setBuild({ projectId: data.projectId, phase: data.phase });
      })
      .catch(() => {});
  }, [sessionId]);

  // Scroll to bottom whenever messages update
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || streaming) return;

    const userMsg: Message = { role: "user", content: text, ts: Date.now() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setStreaming(true);

    // Placeholder for the assistant reply
    const assistantTs = Date.now();
    setMessages((prev) => [...prev, { role: "assistant", content: "", ts: assistantTs }]);

    try {
      const res = await fetch(`${API}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, sessionId }),
      });

      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const lines = decoder.decode(value).split("\n");
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;

          try {
            const chunk = JSON.parse(raw) as {
              type: string;
              content?: string;
              phase?: string;
              projectId?: string;
            };

            if (chunk.type === "token" && chunk.content) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.ts === assistantTs
                    ? { ...m, content: m.content + chunk.content }
                    : m,
                ),
              );
            }

            if (chunk.type === "phase_change" && chunk.phase === "building") {
              // Pipeline started — will get projectId from next event
            }

            if (chunk.type === "project_started" && chunk.projectId) {
              setBuild({ projectId: chunk.projectId, phase: "generate" });
            }

            if (chunk.type === "error" && chunk.content) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.ts === assistantTs ? { ...m, content: chunk.content ?? "" } : m,
                ),
              );
            }
          } catch { /* skip malformed chunk */ }
        }
      }
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.ts === assistantTs
            ? { ...m, content: "Something went wrong. Please try again." }
            : m,
        ),
      );
      console.error("[chat]", err);
    } finally {
      setStreaming(false);
      inputRef.current?.focus();
    }
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6">
        {messages.length === 0 && (
          <div className="text-center text-gray-500 mt-24 select-none">
            <p className="text-2xl font-semibold text-gray-300 mb-2">What do you want to build?</p>
            <p className="text-sm">Describe your idea and we'll handle the rest.</p>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.ts}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                msg.role === "user"
                  ? "bg-indigo-600 text-white rounded-br-sm"
                  : "bg-gray-800 text-gray-100 rounded-bl-sm"
              }`}
            >
              {msg.content}
              {msg.role === "assistant" && msg.content === "" && (
                <span className="inline-block w-2 h-4 bg-gray-400 animate-pulse rounded-sm" />
              )}
            </div>
          </div>
        ))}

        {/* Build status banner */}
        {build && (
          <div className="flex justify-center">
            <a
              href={`/build/${build.projectId}`}
              className="text-xs px-4 py-2 bg-indigo-900 text-indigo-300 rounded-full hover:bg-indigo-800 transition"
            >
              Build in progress — view live status →
            </a>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-gray-800 px-4 py-4">
        <div className="flex items-end gap-3 max-w-3xl mx-auto">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Describe what you want to build..."
            rows={1}
            disabled={streaming}
            className="flex-1 resize-none bg-gray-800 text-gray-100 placeholder-gray-500 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 max-h-40 overflow-y-auto"
            style={{ minHeight: "44px" }}
          />
          <button
            onClick={() => void send()}
            disabled={streaming || !input.trim()}
            className="px-5 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl text-sm font-semibold transition shrink-0"
          >
            {streaming ? "..." : "Send"}
          </button>
        </div>
        <p className="text-center text-xs text-gray-600 mt-2">Enter to send · Shift+Enter for new line</p>
      </div>
    </div>
  );
}
