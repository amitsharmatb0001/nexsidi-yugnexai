import { Request, Response, NextFunction } from "express";

export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  console.error("[Error Handler]", err);

  const status = err.status || err.statusCode || 500;
  const message = err.message || "Something went wrong";

  res.status(status).json({
    success: false,
    error: message,
  });
};
