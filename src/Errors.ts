export class StatusError extends Error {
  statusCode?: number;
  body: any;
}

export class NotFoundError extends StatusError {
  statusCode = 404;
  constructor() {
    super("Not Found");
  }
}

export class BadRequestError extends StatusError {
  statusCode = 400;
  constructor(body?: any) {
    super("Bad Request");
    this.body = body;
  }
}

export class ComplexityError extends BadRequestError {
  statusCode = 400;
  constructor() {
    super("Bad Request");
    this.body = {
      error: "Complexity limit reached",
    };
  }
}

export class UnauthorizedError extends StatusError {
  statusCode = 401;
  constructor() {
    super("Unauthorized");
  }
}
