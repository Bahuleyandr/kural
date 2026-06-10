import { useEffect, useState } from "react";

import { getDesktopDiagnostics, type DesktopDiagnostics } from "../lib/api";

export function ReleaseDiagnosticsPanel(props: {
  apiUrl: string;
  backendStatus: string | null;
  backendError: string | null;
}) {
  const [diagnostics, setDiagnostics] = useState<DesktopDiagnostics | null>(null);
  const [error, setError] = useState("");

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
    return () => {
      cancelled = true;
    };
  }, []);

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
            props.backendStatus === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-amber-200 bg-amber-50 text-amber-800"
          }`}
          aria-live="polite"
        >
          Backend: {props.backendStatus || "checking"}
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
      <div className="mt-4 rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
        Keep signed installers, updater keys, and model cache layout aligned before public release.
        This panel gives support a quick local state snapshot without exposing generated audio.
      </div>
    </section>
  );
}
