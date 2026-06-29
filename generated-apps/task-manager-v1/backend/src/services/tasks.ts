import { Pool } from "pg";
import { Task, PaginatedResponse } from "../types/shared";

export const getTasks = async (pool: Pool, userId: string, status?: string, page = 1, perPage = 20): Promise<PaginatedResponse<Task>> => {
  let query = "SELECT * FROM tasks WHERE user_id = $1";
  const params: unknown[] = [userId];

  if (status === "completed") {
    params.push(true);
    query += ` AND is_completed = $${params.length}`;
  } else if (status === "pending") {
    params.push(false);
    query += ` AND is_completed = $${params.length}`;
  }

  query += " ORDER BY created_at DESC";
  params.push(perPage); query += ` LIMIT $${params.length}`;
  params.push((page - 1) * perPage); query += ` OFFSET $${params.length}`;

  const result = await pool.query(query, params);
  const countRes = await pool.query("SELECT COUNT(*) FROM tasks WHERE user_id = $1", [userId]);

  return { items: result.rows, total: parseInt(countRes.rows[0].count, 10), page, perPage };
};

export const createTask = async (pool: Pool, userId: string, taskData: { title: string; description?: string; dueDate?: string | null }): Promise<Task> => {
  const result = await pool.query(
    "INSERT INTO tasks (user_id, title, description, due_date) VALUES ($1, $2, $3, $4) RETURNING *",
    [userId, taskData.title, taskData.description ?? null, taskData.dueDate ?? null]
  );
  return result.rows[0];
};

export const updateTask = async (pool: Pool, userId: string, taskId: string, taskData: { title?: string; description?: string | null; dueDate?: string | null; isCompleted?: boolean }): Promise<void> => {
  const sets: string[] = [];
  const params: unknown[] = [];

  if (taskData.title !== undefined)       { params.push(taskData.title);       sets.push(`title = $${params.length}`); }
  if (taskData.description !== undefined) { params.push(taskData.description); sets.push(`description = $${params.length}`); }
  if (taskData.dueDate !== undefined)     { params.push(taskData.dueDate);     sets.push(`due_date = $${params.length}`); }
  if (taskData.isCompleted !== undefined) { params.push(taskData.isCompleted); sets.push(`is_completed = $${params.length}`); }

  if (sets.length === 0) return;

  sets.push(`updated_at = now()`);
  params.push(taskId);  const idIdx  = params.length;
  params.push(userId);  const uidIdx = params.length;

  await pool.query(`UPDATE tasks SET ${sets.join(", ")} WHERE id = $${idIdx} AND user_id = $${uidIdx}`, params);
};

export const deleteTask = async (pool: Pool, userId: string, taskId: string): Promise<void> => {
  await pool.query("DELETE FROM tasks WHERE id = $1 AND user_id = $2", [taskId, userId]);
};
