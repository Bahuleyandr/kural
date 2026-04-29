import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _resetUseApiCache } from "../app/hooks/useApi";
import { apiFetch, readApiError } from "../app/lib/api";

const originalFetch = global.fetch;

describe("api wrapper", () => {
  beforeEach(() => {
    _resetUseApiCache();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("apiFetch does not inject X-API-Key when no API key is set", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok"));
    global.fetch = fetchMock as typeof fetch;

    await apiFetch("http://example/api/voices");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = (fetchMock.mock.calls[0][1] ?? {}) as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get("X-API-Key")).toBeNull();
  });

  it("apiFetch injects X-API-Key when NEXT_PUBLIC_KURAL_API_KEY is set", async () => {
    vi.stubEnv("NEXT_PUBLIC_KURAL_API_KEY", "secret-token");
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok"));
    global.fetch = fetchMock as typeof fetch;

    await apiFetch("http://example/api/voices");

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get("X-API-Key")).toBe("secret-token");
  });

  it("readApiError surfaces structured detail.message", async () => {
    const res = new Response(JSON.stringify({ detail: { message: "nope" } }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
    expect(await readApiError(res)).toBe("401: nope");
  });

  it("readApiError falls back to plaintext bodies", async () => {
    const res = new Response("server exploded", {
      status: 500,
      headers: { "Content-Type": "text/plain" },
    });
    expect(await readApiError(res)).toBe("500: server exploded");
  });
});
