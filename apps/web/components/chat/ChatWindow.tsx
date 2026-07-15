"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { nanoid } from "nanoid";

interface AttachedFile {
  name: string;
  type: string;
  content: string; // text content or data: URI for images
  size: number;
}

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
  const [attachments, setAttachments] = useState<AttachedFile[]>([]);
  const [dragging, setDragging]     = useState(false);
  const bottomRef                   = useRef<HTMLDivElement>(null);
  const inputRef                    = useRef<HTMLTextAreaElement>(null);
  const fileInputRef                = useRef<HTMLInputElement>(null);

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

  // Read a File into an AttachedFile record
  const readFile = useCallback((file: File): Promise<AttachedFile> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      const isText = file.type.startsWith("text/") || /\.(txt|md|json|ts|tsx|js|jsx|css|html|xml|yaml|yml|csv|py|rb|go|rs|sh|env|toml|ini)$/i.test(file.name);
      const isImage = file.type.startsWith("image/");

      reader.onload = (e) => {
        resolve({
          name: file.name,
          type: file.type || "application/octet-stream",
          content: String(e.target?.result ?? ""),
          size: file.size,
        });
      };

      if (isText) reader.readAsText(file);
      else if (isImage) reader.readAsDataURL(file);
      else reader.readAsDataURL(file);
    });
  }, []);

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const arr = Array.from(files).slice(0, 5); // max 5 files
    const read = await Promise.all(arr.map(readFile));
    setAttachments((prev) => [...prev, ...read].slice(0, 5));
  }, [readFile]);

  const removeAttachment = (name: string) => {
    setAttachments((prev) => prev.filter((a) => a.name !== name));
  };

  // Build the message text — inline file content as context
  function buildMessageWithAttachments(text: string, files: AttachedFile[]): string {
    if (files.length === 0) return text;
    const fileContext = files.map((f) => {
      if (f.type.startsWith("image/")) {
        return `[Attached image: ${f.name}]`;
      }
      const preview = f.content.length > 8000 ? f.content.slice(0, 8000) + "\n...(truncated)" : f.content;
      return `--- Attached file: ${f.name} ---\n${preview}\n--- End of ${f.name} ---`;
    }).join("\n\n");
    return `${text}\n\n${fileContext}`;
  }

  async function send() {
    const text = input.trim();
    if (!text && attachments.length === 0) return;
    if (streaming) return;

    const fullMessage = buildMessageWithAttachments(text || "(see attached files)", attachments);
    const userMsg: Message = { role: "user", content: fullMessage, ts: Date.now() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setAttachments([]);
    setStreaming(true);

    // Placeholder for the assistant reply
    const assistantTs = Date.now();
    setMessages((prev) => [...prev, { role: "assistant", content: "", ts: assistantTs }]);

    try {
      const res = await fetch(`${API}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: fullMessage, sessionId }),
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

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) void handleFiles(e.dataTransfer.files);
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
      <div
        className={`border-t px-4 py-4 transition-colors ${dragging ? "border-indigo-500 bg-indigo-950/30" : "border-gray-800"}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="*/*"
          className="hidden"
          onChange={(e) => { if (e.target.files) void handleFiles(e.target.files); e.target.value = ""; }}
        />

        {/* Attachment chips */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2 max-w-3xl mx-auto">
            {attachments.map((f) => (
              <div key={f.name} className="flex items-center gap-1 px-3 py-1 bg-gray-800 border border-gray-700 rounded-full text-xs text-gray-300">
                <span>{f.type.startsWith("image/") ? "🖼" : "📄"}</span>
                <span className="max-w-[160px] truncate">{f.name}</span>
                <span className="text-gray-500">({Math.round(f.size / 1024)}KB)</span>
                <button onClick={() => removeAttachment(f.name)} className="ml-1 text-gray-500 hover:text-gray-200 transition">×</button>
              </div>
            ))}
          </div>
        )}

        {dragging && (
          <div className="flex items-center justify-center py-3 mb-2 border-2 border-dashed border-indigo-500 rounded-xl text-indigo-400 text-sm max-w-3xl mx-auto">
            Drop files here to attach
          </div>
        )}

        <div className="flex items-end gap-2 max-w-3xl mx-auto">
          {/* Attach button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={streaming}
            title="Attach files (text, images, code)"
            className="shrink-0 w-10 h-10 flex items-center justify-center rounded-xl bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-400 hover:text-gray-200 disabled:opacity-40 transition text-lg"
          >
            📎
          </button>

          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder={attachments.length > 0 ? "Add a message or just send the files..." : "Describe what you want to build..."}
            rows={1}
            disabled={streaming}
            className="flex-1 resize-none bg-gray-800 text-gray-100 placeholder-gray-500 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 max-h-40 overflow-y-auto"
            style={{ minHeight: "44px" }}
          />
          <button
            onClick={() => void send()}
            disabled={streaming || (!input.trim() && attachments.length === 0)}
            className="px-5 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl text-sm font-semibold transition shrink-0"
          >
            {streaming ? "..." : "Send"}
          </button>
        </div>
        <p className="text-center text-xs text-gray-600 mt-2">Enter to send · Shift+Enter for new line · Drag &amp; drop files to attach</p>
      </div>
    </div>
  );
}
