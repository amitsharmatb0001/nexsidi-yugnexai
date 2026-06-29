export interface Task {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  dueDate: Date | null;
  isCompleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export enum TaskStatus {
  PENDING = 'pending',
  COMPLETED = 'completed'
}

export interface ApiErrorResponse {
  status: number;
  message: string;
  code?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
}

export interface CreateTaskRequest {
  title: string;
  description?: string;
  dueDate?: string; // ISO 8601 format
}

export interface UpdateTaskRequest {
  title?: string;
  description?: string | null;
  dueDate?: string | null; // ISO 8601 format
  isCompleted?: boolean;
}