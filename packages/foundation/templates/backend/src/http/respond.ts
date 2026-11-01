import type { NextFunction, Request, RequestHandler, Response } from "express";

/** A success answer: the payload is always inside `data`. */
export function ok(res: Response, data: unknown, status = 200): void {
  res.status(status).json({ success: true, data });
}

/** A refusal or failure: `error` is the message to show. */
export function fail(res: Response, status: number, error: string): void {
  res.status(status).json({ success: false, error });
}

/** Wraps an async handler, so a thrown error reaches the error middleware. */
export function handler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
