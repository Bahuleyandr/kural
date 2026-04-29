function getInjectedValue(key: string): string {
  if (typeof window === "undefined") return "";
  const injected = (window as unknown as Record<string, unknown>)[key];
  return typeof injected === "string" ? injected : "";
}

export function getApiUrl(): string {
  const injected = getInjectedValue("__KURAL_API_URL__");
  return injected || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
}

function getApiKey(): string {
  const injected = getInjectedValue("__KURAL_API_KEY__");
  return injected || process.env.NEXT_PUBLIC_KURAL_API_KEY || "";
}

export async function readApiError(res: Response): Promise<string> {
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const data = await res.json();
    const detail = data?.detail;
    if (detail?.message) return `${res.status}: ${detail.message}`;
    if (typeof detail === "string") return `${res.status}: ${detail}`;
    return `${res.status}: ${JSON.stringify(data)}`;
  }
  return `${res.status}: ${await res.text()}`;
}

/**
 * Fetch wrapper that injects the optional X-API-Key header. Use for every
 * /api/* request so that networked deployments can require auth without
 * touching call sites.
 */
export function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const apiKey = getApiKey();
  if (!apiKey) return fetch(input, init);
  const headers = new Headers(init.headers);
  headers.set("X-API-Key", apiKey);
  return fetch(input, { ...init, headers });
}
