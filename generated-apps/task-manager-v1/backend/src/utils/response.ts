export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
}

export function successResponse(data: any) {
  return { status: 'success', data };
}

export function errorResponse(error: string, code?: string) {
  return { status: 'error', message: error, code };
}