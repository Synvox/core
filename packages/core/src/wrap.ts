import { Request, Response, NextFunction } from "express";
import { StatusError } from "./errors";

export const wrap = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await fn(req, res, next);
    if (result !== undefined) res.json(result);
  } catch (e) {
    if (typeof e.statusCode === "number") {
      const error = e as StatusError;

      let body = error.body;

      if (error.body === undefined) {
        if (process.env.NODE_ENV === "production")
          body = { errors: { base: "An error occurred" } };
        else {
          body = {
            errors: { base: error.message },
            stack: error.stack,
          };
        }
      }
      res.status(error.statusCode!).json(body);
    } else next(e);
  }
};
