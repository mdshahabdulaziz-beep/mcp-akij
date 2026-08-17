export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(message: string, code: string, statusCode = 500) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class ConfigError extends AppError {
  constructor(message: string) {
    super(message, 'CONFIG_ERROR', 500);
    this.name = 'ConfigError';
  }
}

export class AuthError extends AppError {
  constructor(message: string) {
    super(message, 'AUTH_ERROR', 401);
    this.name = 'AuthError';
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super(message, 'NOT_FOUND', 404);
    this.name = 'NotFoundError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string) {
    super(message, 'FORBIDDEN', 403);
    this.name = 'ForbiddenError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR', 400);
    this.name = 'ValidationError';
  }
}

export class UnsupportedFileTypeError extends AppError {
  constructor(message: string) {
    super(message, 'UNSUPPORTED_FILE_TYPE', 415);
    this.name = 'UnsupportedFileTypeError';
  }
}

export class FileTooLargeError extends AppError {
  constructor(message: string) {
    super(message, 'FILE_TOO_LARGE', 413);
    this.name = 'FileTooLargeError';
  }
}

export class UpstreamApiError extends AppError {
  constructor(message: string) {
    super(message, 'UPSTREAM_API_ERROR', 502);
    this.name = 'UpstreamApiError';
  }
}

/**
 * Converts any thrown value into a safe, user-facing message.
 * Never includes stack traces, credential material, or raw upstream error bodies.
 */
export function toSafeErrorMessage(err: unknown): { message: string; code: string } {
  if (err instanceof AppError) {
    return { message: err.message, code: err.code };
  }
  if (err instanceof Error) {
    return { message: err.message, code: 'INTERNAL_ERROR' };
  }
  return { message: 'An unknown error occurred', code: 'UNKNOWN_ERROR' };
}
