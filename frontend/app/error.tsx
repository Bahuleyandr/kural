"use client";

import { useEffect } from "react";

import { apiFetch, getApiUrl } from "./lib/api";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Kural workspace error", error);
    const url = `${getApiUrl()}/api/telemetry`;
    void apiFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "frontend_render_error",
        message: error.message,
        digest: error.digest,
        extra: { stack: error.stack ?? null },
      }),
    }).catch(() => {
      // Telemetry is best-effort and opt-in server-side; never block recovery.
    });
  }, [error]);

  return (
    <main
      className="min-h-screen bg-slate-100 px-6 py-10 text-slate-950"
      role="alert"
      aria-live="assertive"
    >
      <div className="mx-auto max-w-xl rounded border border-red-300 bg-white p-6">
        <h1 className="text-xl font-semibold">Something went wrong in the workspace.</h1>
        <p className="mt-2 text-sm text-slate-700">
          The error has been logged to the browser console. Reload the workspace, or report the
          digest below if the problem persists.
        </p>
        {error.digest && (
          <p className="mt-2 font-mono text-xs text-slate-500">digest: {error.digest}</p>
        )}
        <pre className="mt-3 max-h-48 overflow-auto rounded border border-slate-200 bg-slate-50 p-3 font-mono text-xs">
          {error.message}
        </pre>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            className="rounded bg-slate-950 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-slate-400"
            onClick={reset}
          >
            Try again
          </button>
          <button
            type="button"
            className="rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
            onClick={() => {
              if (typeof window !== "undefined") window.location.reload();
            }}
          >
            Reload workspace
          </button>
        </div>
      </div>
    </main>
  );
}
