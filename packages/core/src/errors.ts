export class StatusError extends Error {
  statusCode?: number;
  body: any;
}

export class NotFoundError extends StatusError {
  statusCode = 404;
  constructor() {
    super("Not Found");
    this.body = {
      errors: { base: "Not found" },
    };
  }
}

export class BadRequestError extends StatusError {
  statusCode = 400;
  constructor(body?: any) {
    super("Bad Request");
    this.body = { errors: body };
  }
}

export class ComplexityError extends BadRequestError {
  statusCode = 400;
  constructor() {
    super("Bad Request");
    this.body = {
      errors: { base: "Complexity limit reached" },
    };
  }
}

export class NotAuthenticatedError extends StatusError {
  statusCode = 401;
  constructor() {
    super("Not Authenticated");
    this.body = {
      errors: { base: "Not Authenticated" },
    };
  }
}

export class UnauthorizedError extends StatusError {
  statusCode = 403;
  constructor() {
    super("Unauthorized");
    this.body = {
      errors: { base: "Unauthorized" },
    };
  }
}
