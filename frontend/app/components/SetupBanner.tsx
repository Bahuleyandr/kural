"use client";

import { useEffect, useState } from "react";

import { apiFetch, readApiError } from "../lib/api";

interface SetupStatus {
  kokoro_ready: boolean;
  model_dir: string;
  model_files: string[];
  provision_status: "idle" | "running" | "complete" | "error";
  provision_detail?: string | null;
}

export function SetupBanner({ apiUrl }: { apiUrl: string }) {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      try {
        const res = await apiFetch(`${apiUrl}/api/setup/status`);
        if (!res.ok) throw new Error(await readApiError(res));
        const data = (await res.json()) as SetupStatus;
        if (cancelled) return;
        setStatus(data);
        setError(null);
        if (!data.kokoro_ready && data.provision_status === "running") {
          timer = setTimeout(tick, 2000);
        }
      } catch (exc) {
        if (cancelled) return;
        setError(exc instanceof Error ? exc.message : "Setup status unavailable");
      }
    }

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [apiUrl]);

  async function provision() {
    setBusy(true);
    try {
      const res = await apiFetch(`${apiUrl}/api/setup/provision-models`, { method: "POST" });
      if (!res.ok) throw new Error(await readApiError(res));
      const data = (await res.json()) as SetupStatus;
      setStatus(data);
      setError(null);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Could not start model download");
    } finally {
      setBusy(false);
    }
  }

  if (!status || status.kokoro_ready) {
    if (!status && error) {
      return (
        <div
          className="mb-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
          role="status"
          aria-live="polite"
        >
          Setup status unavailable: {error}
        </div>
      );
    }
    return null;
  }

  const running = status.provision_status === "running";
  const errored = status.provision_status === "error";

  return (
    <div
      className="mb-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
      role="status"
      aria-live="polite"
    >
      <p className="font-semibold">Kokoro speech models are not installed yet.</p>
      <p className="mt-1 text-xs">
        Expected at <code className="font-mono">{status.model_dir}</code> /{" "}
        {status.model_files.join(", ")}.
      </p>
      {errored && status.provision_detail && (
        <p className="mt-1 text-red-700">Last attempt: {status.provision_detail}</p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded bg-amber-700 px-3 py-2 text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:opacity-50"
          disabled={busy || running}
          onClick={() => void provision()}
          aria-busy={busy || running}
        >
          {running ? "Downloading models..." : busy ? "Starting..." : "Download Kokoro models"}
        </button>
        {error && <span className="text-xs text-red-700">{error}</span>}
      </div>
    </div>
  );
}
