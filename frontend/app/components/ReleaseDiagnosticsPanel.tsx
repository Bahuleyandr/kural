import { useEffect, useState } from "react";

import {
  apiFetch,
  getDesktopDiagnostics,
  openLocalLogs,
  readApiError,
  restartLocalBackend,
  type DesktopDiagnostics,
} from "../lib/api";

interface RuntimeCheck {
  id: string;
  label: string;
  status: "ready" | "warning" | "missing" | "error";
  detail: string;
  repair_action?: string | null;
}

interface RuntimeHealthChecksResponse {
  status: "ready" | "needs_setup" | "error";
  checks: RuntimeCheck[];
  storage: Record<string, string | number | boolean>;
}

export function ReleaseDiagnosticsPanel(props: {
  apiUrl: string;
  backendStatus: string | null;
  backendError: string | null;
}) {
  const [diagnostics, setDiagnostics] = useState<DesktopDiagnostics | null>(null);
  const [runtime, setRuntime] = useState<RuntimeHealthChecksResponse | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");

  async function refreshDiagnostics() {
    try {
      setDiagnostics(await getDesktopDiagnostics());
      const res = await apiFetch(`${props.apiUrl}/api/runtime/health-checks`);
      if (res.ok) setRuntime((await res.json()) as RuntimeHealthChecksResponse);
      setError("");
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Desktop diagnostics unavailable.");
    }
  }

  useEffect(() => {
    let cancelled = false;
    void getDesktopDiagnostics()
      .then((result) => {
        if (!cancelled) setDiagnostics(result);
      })
      .catch((exc) => {
        if (!cancelled) {
          setError(exc instanceof Error ? exc.message : "Desktop diagnostics unavailable.");
        }
      });
    void apiFetch(`${props.apiUrl}/api/runtime/health-checks`)
      .then(async (res) => {
        if (!cancelled && res.ok) setRuntime((await res.json()) as RuntimeHealthChecksResponse);
        if (!cancelled && !res.ok) setError(await readApiError(res));
      })
      .catch((exc) => {
        if (!cancelled) setError(exc instanceof Error ? exc.message : "Runtime checks unavailable.");
      });
    return () => {
      cancelled = true;
    };
  }, [props.apiUrl]);

  async function restartEngine() {
    setBusy("restart");
    setMessage("");
    setError("");
    try {
      const restarted = await restartLocalBackend();
      setMessage(
        restarted
          ? "Local engine restarted."
          : "Restart is available only in the desktop app."
      );
      await refreshDiagnostics();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Could not restart the local engine.");
    } finally {
      setBusy("");
    }
  }

  async function openLogs() {
    setBusy("logs");
    setMessage("");
    setError("");
    try {
      const opened = await openLocalLogs();
      setMessage(opened ? "Opened local logs folder." : "Logs folder is available only in the desktop app.");
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Could not open the logs folder.");
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="rounded border border-slate-300 bg-white p-4" aria-labelledby="release-diagnostics-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Installer health</p>
          <h2 id="release-diagnostics-heading" className="text-lg font-semibold">
            Desktop Release Diagnostics
          </h2>
        </div>
        <span
          className={`rounded border px-3 py-1 text-sm ${
            props.backendStatus
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-amber-200 bg-amber-50 text-amber-800"
          }`}
          aria-live="polite"
        >
          Local engine: {props.backendStatus || "starting"}
        </span>
      </div>
      <dl className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="rounded border border-slate-200 p-3">
          <dt className="text-xs uppercase text-slate-500">API URL</dt>
          <dd className="mt-1 break-all text-sm">{diagnostics?.backendUrl || props.apiUrl}</dd>
        </div>
        <div className="rounded border border-slate-200 p-3">
          <dt className="text-xs uppercase text-slate-500">API key</dt>
          <dd className="mt-1 text-sm">
            {diagnostics ? (diagnostics.apiKeyPresent ? "Configured" : "Missing") : "Browser mode"}
          </dd>
        </div>
        <div className="rounded border border-slate-200 p-3">
          <dt className="text-xs uppercase text-slate-500">Audio folder</dt>
          <dd className="mt-1 break-all text-sm">{diagnostics?.audioLibraryDir || "Browser download folder"}</dd>
        </div>
        <div className="rounded border border-slate-200 p-3">
          <dt className="text-xs uppercase text-slate-500">App data</dt>
          <dd className="mt-1 break-all text-sm">{diagnostics?.appDataDir || "Unavailable outside desktop"}</dd>
        </div>
      </dl>
      {(props.backendError || diagnostics?.backendError || error) && (
        <p className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {props.backendError || diagnostics?.backendError || error}
        </p>
      )}
      {message && (
        <p className="mt-3 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800" role="status">
          {message}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:opacity-50"
          disabled={Boolean(busy)}
          onClick={() => void restartEngine()}
        >
          {busy === "restart" ? "Restarting..." : "Restart Local Engine"}
        </button>
        <button
          type="button"
          className="rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:opacity-50"
          disabled={Boolean(busy)}
          onClick={() => void openLogs()}
        >
          {busy === "logs" ? "Opening..." : "Open Logs Folder"}
        </button>
      </div>
      {runtime && (
        <section className="mt-4 rounded border border-slate-200 bg-slate-50 p-3" aria-label="Runtime health checks">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-medium">Runtime Health</h3>
            <span className="rounded border border-slate-200 bg-white px-2 py-1 text-xs">
              {runtime.status.replace("_", " ")}
            </span>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {runtime.checks.map((check) => (
              <div key={check.id} className="rounded border border-slate-200 bg-white p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{check.label}</span>
                  <span
                    className={`rounded border px-2 py-1 text-xs ${
                      check.status === "ready"
                        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                        : "border-amber-200 bg-amber-50 text-amber-800"
                    }`}
                  >
                    {check.status}
                  </span>
                </div>
                <p className="mt-1 break-all text-xs text-slate-600">{check.detail}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 break-all text-xs text-slate-600">
            Model root: {String(runtime.storage.model_pack_root || "unknown")} / sampled{" "}
            {String(runtime.storage.model_files_sampled || 0)} files
          </p>
        </section>
      )}
      <div className="mt-4 rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
        Keep signed installers, updater keys, and model cache layout aligned before public release.
        This panel gives support a quick local runtime snapshot without exposing generated audio.
      </div>
    </section>
  );
}
