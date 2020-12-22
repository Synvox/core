export class StatusError extends Error {
  statusCode?: number;
  body: any;
}

export class NotFoundError extends StatusError {
  statusCode = 404;
  constructor() {
    super('Not Found');
  }
}

export class BadRequestError extends StatusError {
  statusCode = 400;
  constructor(body?: any) {
    super('Bad Request');
    this.body = body;
  }
}

export class UnauthorizedError extends StatusError {
  statusCode = 401;
  constructor() {
    super('Unauthorized');
  }
}
