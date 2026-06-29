"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { Task } from "@/shared/types";

interface CreateForm { title: string; dueDate: string; }

export default function TasksPage() {
  const { getToken, isLoaded } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [form, setForm] = useState<CreateForm>({ title: "", dueDate: "" });
  const [loading, setLoading] = useState(true);
  const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

  const fetchTasks = async () => {
    const token = await getToken();
    const res = await fetch(`${api}/api/v1/tasks`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) { const data = await res.json(); setTasks(data.items ?? data); }
    setLoading(false);
  };

  useEffect(() => { if (isLoaded) fetchTasks(); }, [isLoaded]);

  const createTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    const token = await getToken();
    const res = await fetch(`${api}/api/v1/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ title: form.title, dueDate: form.dueDate || null }),
    });
    if (res.ok) { setForm({ title: "", dueDate: "" }); fetchTasks(); }
  };

  const toggleTask = async (task: Task) => {
    const token = await getToken();
    await fetch(`${api}/api/v1/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ isCompleted: !task.isCompleted }),
    });
    fetchTasks();
  };

  const deleteTask = async (id: string) => {
    const token = await getToken();
    await fetch(`${api}/api/v1/tasks/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    fetchTasks();
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header className="bg-white dark:bg-gray-800 shadow">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">My Tasks</h1>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <form onSubmit={createTask} className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm space-y-4">
          <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-200">Add Task</h2>
          <div className="flex gap-3">
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Task title…"
              className="flex-1 rounded-lg border border-gray-200 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            />
            <input
              type="date"
              value={form.dueDate}
              onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            />
            <button
              type="submit"
              className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
            >
              Add
            </button>
          </div>
        </form>

        <div className="space-y-3">
          {loading && <p className="text-center text-gray-500 py-8">Loading…</p>}
          {!loading && tasks.length === 0 && (
            <p className="text-center text-gray-400 py-8">No tasks yet. Add one above!</p>
          )}
          {tasks.map((task) => (
            <div
              key={task.id}
              className={`bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm flex items-start gap-4 transition-opacity ${task.isCompleted ? "opacity-60" : ""}`}
            >
              <button
                onClick={() => toggleTask(task)}
                className={`mt-0.5 h-5 w-5 shrink-0 rounded border-2 flex items-center justify-center transition-colors ${task.isCompleted ? "bg-green-500 border-green-500 text-white" : "border-gray-300 hover:border-green-400"}`}
              >
                {task.isCompleted && <span className="text-xs">✓</span>}
              </button>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${task.isCompleted ? "line-through text-gray-400" : "text-gray-900 dark:text-white"}`}>
                  {task.title}
                </p>
                {task.dueDate && (
                  <p className="text-xs text-gray-500 mt-0.5">
                    Due {new Date(task.dueDate).toLocaleDateString()}
                  </p>
                )}
              </div>
              <button
                onClick={() => deleteTask(task.id)}
                className="text-gray-300 hover:text-red-400 transition-colors text-sm"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
