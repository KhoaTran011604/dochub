import { OutlineApiError, OutlineNetworkError, OutlineTimeoutError, toOutlineApiError } from "./outline-api-errors.ts";

export interface OutlineHttpClientOptions {
  /** `OUTLINE_URL`, không có "/" cuối. */
  baseUrl: string;
  /** Token admin (hoặc OAuth token của user ở phase 5), gửi qua `Authorization: Bearer`. */
  token: string;
  timeoutMs?: number;
  /** Số lần GỌI tối đa (không phải số lần thử lại) cho 429/5xx/timeout/network error. */
  maxRetries?: number;
  /** Chỉ dùng trong test để thay `global.fetch`. */
  fetchImpl?: typeof fetch;
}

export interface OutlineRequestOptions {
  /**
   * `false` cho method không idempotent (vd `oauthClients.create`): lỗi
   * mơ hồ (timeout/network/5xx) không retry, vì response mất không có nghĩa
   * Outline chưa tạo xong — retry có thể tạo bản ghi trùng. Mặc định `true`.
   */
  retry?: boolean;
}

export interface OutlineHttpClient {
  /** POST tới `{baseUrl}/api/{method}`, trả thẳng field `data` của response. */
  request<T>(method: string, body?: object, options?: OutlineRequestOptions): Promise<T>;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RETRIES = 3;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Backoff lũy tiến khi không có `Retry-After`: 500ms, 1000ms, 2000ms, ... */
function backoffMs(attempt: number): number {
  return 500 * 2 ** (attempt - 1);
}

function parseRetryAfterSeconds(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

interface OutlineResponseBody {
  ok?: boolean;
  data?: unknown;
  error?: string;
  message?: string;
}

export function createOutlineHttpClient(
  options: OutlineHttpClientOptions,
): OutlineHttpClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const fetchImpl = options.fetchImpl ?? fetch;

  async function attemptRequest<T>(
    method: string,
    body: object,
    attempt: number,
    allowRetry: boolean,
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}/api/${method}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${options.token}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timeoutHandle);
      const isAbort = error instanceof Error && error.name === "AbortError";
      if (allowRetry && attempt < maxRetries) {
        await delay(backoffMs(attempt));
        return attemptRequest(method, body, attempt + 1, allowRetry);
      }
      throw isAbort
        ? new OutlineTimeoutError(method, timeoutMs)
        : new OutlineNetworkError(method, error);
    }
    clearTimeout(timeoutHandle);

    const json: unknown = await response.json().catch(() => undefined);
    const payload: OutlineResponseBody =
      json && typeof json === "object" ? json : {};

    if (response.ok && payload.ok !== false) {
      return payload.data as T;
    }

    const retryAfterSeconds = parseRetryAfterSeconds(
      response.headers.get("retry-after"),
    );
    const retryable = response.status === 429 || response.status >= 500;
    if (allowRetry && retryable && attempt < maxRetries) {
      await delay(
        retryAfterSeconds !== undefined ? retryAfterSeconds * 1000 : backoffMs(attempt),
      );
      return attemptRequest(method, body, attempt + 1, allowRetry);
    }
    throw toOutlineApiError(method, response.status, payload, retryAfterSeconds);
  }

  return {
    request<T>(method: string, body: object = {}, requestOptions?: OutlineRequestOptions) {
      return attemptRequest<T>(method, body, 1, requestOptions?.retry ?? true);
    },
  };
}

export { OutlineApiError };
