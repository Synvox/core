class StatusError extends Error {
  statusCode?: number;
}

export class NotFoundError extends StatusError {
  statusCode = 404;
  constructor() {
    super('Not Found');
  }
}

export class UnauthorizedError extends StatusError {
  statusCode = 401;
  constructor() {
    super('Unauthorized');
  }
}
