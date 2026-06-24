import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

export default async function DashboardPage() {
  const { userId } = await auth();
  if (!userId) redirect("/");

  return (
    <div className="max-w-4xl mx-auto p-8">
      <h1 className="text-3xl font-bold mb-6">Your Projects</h1>
      <p className="text-gray-400">No projects yet. Start a new one below.</p>
      {/* TODO Phase 1: project list + new project form */}
    </div>
  );
}
