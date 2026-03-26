export class AppError extends Error {
  constructor({
    statusCode = 500,
    type = "internal_error",
    code = "internal_error",
    message = "An internal error occurred.",
    details = [],
  } = {}) {
    super(message);
    this.statusCode = statusCode;
    this.type = type;
    this.code = code;
    this.details = details;
  }
}

export const validationError = ({ code = "invalid_input", message, details = [] }) =>
  new AppError({
    statusCode: 400,
    type: "validation_error",
    code,
    message: message || "Request input is invalid.",
    details,
  });

export const unprocessableError = ({ code = "invalid_filters", message, details = [] }) =>
  new AppError({
    statusCode: 422,
    type: "validation_error",
    code,
    message: message || "Request filters are invalid.",
    details,
  });

export const notFoundError = ({ code = "resource_not_found", message }) =>
  new AppError({
    statusCode: 404,
    type: "not_found",
    code,
    message: message || "The requested resource was not found.",
  });

export const conflictError = ({ code = "conflict", message }) =>
  new AppError({
    statusCode: 409,
    type: "conflict",
    code,
    message: message || "The operation conflicts with current state.",
  });

export const upstreamError = ({ code = "live_scrape_failed", message }) =>
  new AppError({
    statusCode: 502,
    type: "upstream_error",
    code,
    message: message || "Live scrape failed.",
  });

export const upstreamTimeoutError = ({
  code = "refresh_timeout_no_cache",
  message,
} = {}) =>
  new AppError({
    statusCode: 504,
    type: "upstream_timeout",
    code,
    message: message || "Live refresh timed out and no cache is available.",
  });

export const buildErrorPayload = (requestId, error) => {
  const payload = {
    error: {
      type: error.type || "internal_error",
      code: error.code || "internal_error",
      message: error.message || "An internal error occurred.",
    },
    meta: {
      request_id: requestId,
      generated_at: new Date().toISOString(),
    },
  };
  if (Array.isArray(error.details) && error.details.length > 0) {
    payload.error.details = error.details;
  }
  return payload;
};

