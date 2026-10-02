/** Lỗi nghiệp vụ có kiểu, map thẳng sang `{ error: { code, message } }` ở error-handling-middleware. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const badRequest = (code: string, message: string): ApiError =>
  new ApiError(400, code, message);
export const unauthorized = (code: string, message: string): ApiError =>
  new ApiError(401, code, message);
export const forbidden = (code: string, message: string): ApiError =>
  new ApiError(403, code, message);
export const notFound = (code: string, message: string): ApiError =>
  new ApiError(404, code, message);
export const conflict = (code: string, message: string): ApiError =>
  new ApiError(409, code, message);
