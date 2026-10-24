export interface CreateTaskRequest {
  title: string;
  description?: string | null;
  dueDate?: string | null;
}

export interface UpdateTaskRequest {
  title?: string;
  description?: string | null;
  dueDate?: string | null;
  isCompleted?: boolean;
}
