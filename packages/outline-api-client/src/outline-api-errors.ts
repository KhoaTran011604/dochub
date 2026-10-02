// Lỗi có kiểu cho outline-http-client: 1 class cho mỗi nhóm HTTP status, để
// caller `instanceof` thay vì so sánh status number rải rác.

export class OutlineApiError extends Error {
  constructor(
    message: string,
    readonly method: string,
    readonly status: number,
    /** `error` field trong body lỗi của Outline, ví dụ "validation_error". */
    readonly code?: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class OutlineBadRequestError extends OutlineApiError {}
export class OutlineUnauthorizedError extends OutlineApiError {}
export class OutlineForbiddenError extends OutlineApiError {}
export class OutlineNotFoundError extends OutlineApiError {}

export class OutlineRateLimitedError extends OutlineApiError {
  constructor(
    message: string,
    method: string,
    code: string | undefined,
    readonly retryAfterSeconds: number | undefined,
  ) {
    super(message, method, 429, code);
  }
}

export class OutlineServerError extends OutlineApiError {}

/** Hết `maxRetries` lần thử vì timeout, không phải do Outline trả lỗi. */
export class OutlineTimeoutError extends Error {
  constructor(
    readonly method: string,
    readonly timeoutMs: number,
  ) {
    super(`Outline API call "${method}" timed out after ${timeoutMs}ms`);
    this.name = "OutlineTimeoutError";
  }
}

/** Hết `maxRetries` lần thử vì lỗi network (DNS, connection refused, ...). */
export class OutlineNetworkError extends Error {
  constructor(
    readonly method: string,
    readonly networkCause: unknown,
  ) {
    super(
      `Outline API call "${method}" failed: ${
        networkCause instanceof Error ? networkCause.message : String(networkCause)
      }`,
    );
    this.name = "OutlineNetworkError";
  }
}

interface OutlineErrorBody {
  error?: string;
  message?: string;
}

/** Map `(status, body)` của response lỗi thành đúng subclass của {@link OutlineApiError}. */
export function toOutlineApiError(
  method: string,
  status: number,
  body: OutlineErrorBody | undefined,
  retryAfterSeconds: number | undefined,
): OutlineApiError {
  const message =
    body?.message ?? body?.error ?? `Outline API returned HTTP ${status}`;
  const code = body?.error;
  switch (status) {
    case 400:
      return new OutlineBadRequestError(message, method, status, code);
    case 401:
      return new OutlineUnauthorizedError(message, method, status, code);
    case 403:
      return new OutlineForbiddenError(message, method, status, code);
    case 404:
      return new OutlineNotFoundError(message, method, status, code);
    case 429:
      return new OutlineRateLimitedError(
        message,
        method,
        code,
        retryAfterSeconds,
      );
    default:
      return new OutlineServerError(message, method, status, code);
  }
}
