import { SignedIn, SignedOut, SignInButton } from "@clerk/nextjs";
import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <h1 className="text-5xl font-bold tracking-tight mb-4">NexSidi</h1>
      <p className="text-xl text-gray-400 mb-10 text-center max-w-xl">
        Describe your idea. We build the app, run QA, and deliver a working product at{" "}
        <code className="text-green-400">localhost:3000</code>.
      </p>
      <SignedOut>
        <SignInButton mode="modal">
          <button className="px-8 py-3 bg-indigo-600 hover:bg-indigo-500 rounded-lg font-semibold transition">
            Get Started
          </button>
        </SignInButton>
      </SignedOut>
      <SignedIn>
        <Link
          href="/dashboard"
          className="px-8 py-3 bg-indigo-600 hover:bg-indigo-500 rounded-lg font-semibold transition"
        >
          Go to Dashboard
        </Link>
      </SignedIn>
    </main>
  );
}
