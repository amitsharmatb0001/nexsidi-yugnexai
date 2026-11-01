import type { NextFunction, Request, Response } from "express";
import { fail } from "../http/respond";

export function notFound(_req: Request, res: Response): void {
  fail(res, 404, "Not found");
}

/** The last middleware: the cause goes to the log, never to the caller. */
export function errorHandler(err: unknown, _req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) return next(err);
  const status = (err as { status?: number }).status;
  if (status && status >= 400 && status < 500) return fail(res, status, "The request could not be read");
  console.error("Unhandled error:", err);
  fail(res, 500, "Something went wrong");
}
