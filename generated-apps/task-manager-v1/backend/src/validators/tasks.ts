export const validateTaskQueryParams = (queryParams: any): { status?: string; page: number; perPage: number } => {
  const status = queryParams.status ? String(queryParams.status).toLowerCase() : undefined;
  const page = Math.max(1, parseInt(queryParams.page as string, 10) || 1);
  const perPage = Math.min(100, Math.max(1, parseInt(queryParams.perPage as string, 10) || 20));

  const validStatuses = ['pending', 'in_progress', 'completed'];
  if (status && !validStatuses.includes(status)) {
    throw new Error("Invalid status parameter");
  }

  return { status, page, perPage };
};
