import { SignedIn, SignedOut, SignInButton } from "@clerk/nextjs";
import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
      {/* Nav */}
      <nav className="flex items-center justify-between px-8 py-5 border-b border-gray-800/60">
        <span className="text-lg font-bold tracking-tight">NexSidi</span>
        <SignedOut>
          <SignInButton mode="modal">
            <button className="text-sm text-gray-400 hover:text-gray-100 transition">
              Sign in
            </button>
          </SignInButton>
        </SignedOut>
        <SignedIn>
          <Link href="/dashboard" className="text-sm text-gray-400 hover:text-gray-100 transition">
            Dashboard →
          </Link>
        </SignedIn>
      </nav>

      {/* Hero */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center animate-fade-in">
        {/* Badge */}
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-indigo-500/30 bg-indigo-500/10 text-indigo-400 text-xs font-medium mb-8">
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse-slow" />
          Autonomous · Multi-Agent · Production-Ready
        </div>

        <h1 className="text-5xl sm:text-6xl font-extrabold tracking-tight mb-6 leading-tight">
          Describe it.
          <br />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-violet-400">
            We build it.
          </span>
        </h1>

        <p className="text-gray-400 text-lg max-w-lg mb-10 leading-relaxed">
          Type your idea. A coordinated multi-agent system designs, builds, tests,
          and delivers a working app — running at{" "}
          <code className="text-green-400 bg-green-400/10 px-1.5 py-0.5 rounded text-sm">
            localhost:3000
          </code>{" "}
          — in minutes.
        </p>

        <SignedOut>
          <SignInButton mode="modal">
            <button className="px-8 py-3.5 bg-indigo-600 hover:bg-indigo-500 active:scale-95 rounded-xl font-semibold text-sm transition-all duration-150 shadow-lg shadow-indigo-500/20">
              Get Started — it&apos;s free
            </button>
          </SignInButton>
        </SignedOut>
        <SignedIn>
          <Link
            href="/chat"
            className="px-8 py-3.5 bg-indigo-600 hover:bg-indigo-500 active:scale-95 rounded-xl font-semibold text-sm transition-all duration-150 shadow-lg shadow-indigo-500/20"
          >
            Start Building →
          </Link>
        </SignedIn>

        {/* Feature pills */}
        <div className="flex flex-wrap justify-center gap-2 mt-12">
          {[
            "Requirements gathering",
            "Adversarial QA",
            "Auto-fix loops",
            "Docker delivery",
            "GitHub archival",
          ].map((f) => (
            <span
              key={f}
              className="px-3 py-1 text-xs text-gray-500 border border-gray-800 rounded-full bg-gray-900"
            >
              {f}
            </span>
          ))}
        </div>
      </div>

      {/* Footer */}
      <footer className="px-8 py-4 border-t border-gray-800/60 text-center text-xs text-gray-700">
        YugNex Technology (OPC) Private Limited · DIPP234393
      </footer>
    </main>
  );
}
