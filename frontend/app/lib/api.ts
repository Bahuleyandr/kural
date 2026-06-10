function getInjectedValue(key: string): string {
  if (typeof window === "undefined") return "";
  const injected = (window as unknown as Record<string, unknown>)[key];
  return typeof injected === "string" ? injected : "";
}

export function getApiUrl(): string {
  const injected = getInjectedValue("__KURAL_API_URL__");
  return injected || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
}

export function getApiKey(): string {
  const injected = getInjectedValue("__KURAL_API_KEY__");
  return injected || process.env.NEXT_PUBLIC_KURAL_API_KEY || "";
}

interface TauriGlobal {
  invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
  core?: { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
}

function getTauriInvoke(): TauriGlobal["invoke"] {
  if (typeof window === "undefined") return undefined;
  const tauri = (window as unknown as { __TAURI__?: TauriGlobal }).__TAURI__;
  return tauri?.invoke ?? tauri?.core?.invoke;
}

export interface DesktopDiagnostics {
  backendUrl: string;
  apiKeyPresent: boolean;
  backendRunning: boolean;
  backendError: string | null;
  appDataDir: string | null;
  audioLibraryDir: string | null;
}

/**
 * After a page reload Tauri's initialization_script does not re-run, so the
 * window globals are gone. Call this once on mount to re-hydrate the API
 * URL and API key from the Tauri command surface. No-op outside Tauri.
 */
export async function rehydrateTauriGlobals(): Promise<void> {
  const invoke = getTauriInvoke();
  if (!invoke) return;
  try {
    if (!getInjectedValue("__KURAL_API_URL__")) {
      const url = (await invoke("get_backend_url")) as string;
      (window as unknown as Record<string, unknown>).__KURAL_API_URL__ = url;
    }
    if (!getInjectedValue("__KURAL_API_KEY__")) {
      const key = (await invoke("get_api_key")) as string;
      (window as unknown as Record<string, unknown>).__KURAL_API_KEY__ = key;
    }
  } catch {
    // Outside Tauri or command unavailable — fall back to env-based config.
  }
}

export async function saveAudioFileToFolder(
  fileName: string,
  blob: Blob
): Promise<string | null> {
  const invoke = getTauriInvoke();
  if (!invoke) return null;

  const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
  return (await invoke("save_audio_file", {
    fileName,
    bytes,
  })) as string;
}

export async function revealSavedFile(path: string): Promise<boolean> {
  const invoke = getTauriInvoke();
  if (!invoke) return false;
  await invoke("reveal_path", { path });
  return true;
}

export async function getDesktopDiagnostics(): Promise<DesktopDiagnostics | null> {
  const invoke = getTauriInvoke();
  if (!invoke) return null;
  return (await invoke("get_runtime_diagnostics")) as DesktopDiagnostics;
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
