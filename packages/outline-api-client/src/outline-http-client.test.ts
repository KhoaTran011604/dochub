import { describe, expect, it, vi } from "vitest";
import { createOutlineHttpClient } from "./outline-http-client.ts";
import {
  OutlineBadRequestError,
  OutlineNetworkError,
  OutlineNotFoundError,
  OutlineRateLimitedError,
  OutlineServerError,
  OutlineTimeoutError,
  OutlineUnauthorizedError,
} from "./outline-api-errors.ts";

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

function fakeFetch() {
  return vi.fn<typeof fetch>();
}

describe("createOutlineHttpClient", () => {
  it("returns the `data` field on a successful call", async () => {
    const fetchImpl = fakeFetch();
    fetchImpl.mockResolvedValue(jsonResponse(200, { ok: true, data: { id: "1" } }));
    const client = createOutlineHttpClient({
      baseUrl: "http://outline.test",
      token: "secret",
      fetchImpl,
    });

    const result = await client.request<{ id: string }>("auth.info");

    expect(result).toEqual({ id: "1" });
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe("http://outline.test/api/auth.info");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>).authorization).toBe(
      "Bearer secret",
    );
  });

  it("strips a trailing slash from baseUrl", async () => {
    const fetchImpl = fakeFetch();
    fetchImpl.mockResolvedValue(jsonResponse(200, { ok: true, data: null }));
    const client = createOutlineHttpClient({
      baseUrl: "http://outline.test/",
      token: "secret",
      fetchImpl,
    });

    await client.request("auth.info");

    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      "http://outline.test/api/auth.info",
    );
  });

  it("maps HTTP 400 to OutlineBadRequestError without retrying", async () => {
    const fetchImpl = fakeFetch();
    fetchImpl.mockResolvedValue(
      jsonResponse(400, { ok: false, error: "bad", message: "nope" }),
    );
    const client = createOutlineHttpClient({
      baseUrl: "http://outline.test",
      token: "secret",
      fetchImpl,
    });

    await expect(client.request("team.update")).rejects.toBeInstanceOf(
      OutlineBadRequestError,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("maps HTTP 401 to OutlineUnauthorizedError without retrying", async () => {
    const fetchImpl = fakeFetch();
    fetchImpl.mockResolvedValue(jsonResponse(401, { ok: false, error: "auth" }));
    const client = createOutlineHttpClient({
      baseUrl: "http://outline.test",
      token: "secret",
      fetchImpl,
    });

    await expect(client.request("team.update")).rejects.toBeInstanceOf(
      OutlineUnauthorizedError,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("maps HTTP 404 to OutlineNotFoundError without retrying", async () => {
    const fetchImpl = fakeFetch();
    fetchImpl.mockResolvedValue(jsonResponse(404, { ok: false, error: "missing" }));
    const client = createOutlineHttpClient({
      baseUrl: "http://outline.test",
      token: "secret",
      fetchImpl,
    });

    await expect(client.request("team.update")).rejects.toBeInstanceOf(
      OutlineNotFoundError,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries on 429 using Retry-After, then succeeds", async () => {
    const fetchImpl = fakeFetch();
    fetchImpl
      .mockResolvedValueOnce(
        jsonResponse(429, { ok: false, error: "rate_limited" }, {
          "retry-after": "0",
        }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { ok: true, data: "done" }));
    const client = createOutlineHttpClient({
      baseUrl: "http://outline.test",
      token: "secret",
      fetchImpl,
      maxRetries: 3,
    });

    const result = await client.request("team.update");

    expect(result).toBe("done");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("gives up on 429 after exhausting retries", async () => {
    const fetchImpl = fakeFetch();
    fetchImpl.mockResolvedValue(
      jsonResponse(429, { ok: false, error: "rate_limited" }, {
        "retry-after": "0",
      }),
    );
    const client = createOutlineHttpClient({
      baseUrl: "http://outline.test",
      token: "secret",
      fetchImpl,
      maxRetries: 2,
    });

    await expect(client.request("team.update")).rejects.toBeInstanceOf(
      OutlineRateLimitedError,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries on 5xx and eventually throws OutlineServerError", async () => {
    const fetchImpl = fakeFetch();
    fetchImpl.mockResolvedValue(jsonResponse(503, { ok: false }));
    const client = createOutlineHttpClient({
      baseUrl: "http://outline.test",
      token: "secret",
      fetchImpl,
      maxRetries: 2,
    });

    await expect(client.request("team.update")).rejects.toBeInstanceOf(
      OutlineServerError,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("throws OutlineTimeoutError after retries on repeated abort", async () => {
    const fetchImpl = fakeFetch();
    fetchImpl.mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const abortError = new Error("aborted");
          abortError.name = "AbortError";
          reject(abortError);
        });
      });
    });
    const client = createOutlineHttpClient({
      baseUrl: "http://outline.test",
      token: "secret",
      fetchImpl,
      timeoutMs: 1,
      maxRetries: 2,
    });

    await expect(client.request("team.update")).rejects.toBeInstanceOf(
      OutlineTimeoutError,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("throws OutlineNetworkError after retries on connection failure", async () => {
    const fetchImpl = fakeFetch();
    fetchImpl.mockRejectedValue(new Error("ECONNREFUSED"));
    const client = createOutlineHttpClient({
      baseUrl: "http://outline.test",
      token: "secret",
      fetchImpl,
      maxRetries: 2,
    });

    await expect(client.request("team.update")).rejects.toBeInstanceOf(
      OutlineNetworkError,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 5xx when `retry: false` (non-idempotent call)", async () => {
    const fetchImpl = fakeFetch();
    fetchImpl.mockResolvedValue(jsonResponse(503, { ok: false }));
    const client = createOutlineHttpClient({
      baseUrl: "http://outline.test",
      token: "secret",
      fetchImpl,
      maxRetries: 3,
    });

    await expect(
      client.request("oauthClients.create", {}, { retry: false }),
    ).rejects.toBeInstanceOf(OutlineServerError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
