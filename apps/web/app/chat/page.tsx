import { ChatWindow } from "@/components/chat/ChatWindow";

export const metadata = { title: "NexSidi — Build" };

export default async function ChatPage() {
  return (
    <div className="flex flex-col h-screen bg-gray-950">
      {/* Minimal header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-gray-800 shrink-0">
        <a href="/" className="text-lg font-bold tracking-tight">NexSidi</a>
        <a href="/dashboard" className="text-sm text-gray-400 hover:text-gray-200 transition">
          My Projects
        </a>
      </header>

      {/* Chat takes up remaining height */}
      <div className="flex-1 overflow-hidden">
        <ChatWindow />
      </div>
    </div>
  );
}
