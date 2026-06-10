import { useCallback, useEffect, useMemo, useState } from "react";

import { apiFetch, readApiError } from "../lib/api";
import type {
  BackgroundJob,
  LocalModelInfo,
  ModelPackAction,
  ModelPackInfo,
  ModelPacksResponse,
} from "../lib/types";

const WORKFLOW_UNLOCKS = [
  {
    label: "Text to speech",
    match: (pack: ModelPackInfo) => pack.category === "tts",
  },
  {
    label: "Voice cloning",
    match: (pack: ModelPackInfo) => pack.capabilities.includes("voice-clone"),
  },
  {
    label: "Dictation and ASR",
    match: (pack: ModelPackInfo) => pack.category === "asr",
  },
  {
    label: "Offline translation",
    match: (pack: ModelPackInfo) => pack.category === "translation",
  },
];

const TERMINAL = new Set<BackgroundJob["status"]>(["succeeded", "failed", "canceled"]);

function statusClass(status: ModelPackInfo["status"] | BackgroundJob["status"]) {
  if (status === "ready" || status === "succeeded") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }
  if (status === "running" || status === "queued") {
    return "border-blue-200 bg-blue-50 text-blue-800";
  }
  if (status === "disabled" || status === "canceled") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }
  if (status === "error" || status === "failed") {
    return "border-red-200 bg-red-50 text-red-800";
  }
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function modelReadiness(packs: ModelPackInfo[], match: (pack: ModelPackInfo) => boolean) {
  const matched = packs.filter(match);
  const ready = matched.filter((pack) => pack.status === "ready").length;
  return { ready, total: matched.length };
}

function fallbackPacks(models: LocalModelInfo[]): ModelPackInfo[] {
  return models.map((model) => ({
    id: model.id,
    name: model.name,
    category: model.category,
    provider: model.provider,
    status: model.status,
    version: "installed-runtime",
    source_url: null,
    checksum: null,
    license: model.license,
    disk_size_mb: null,
    installed_path: model.path,
    languages: model.languages || [],
    capabilities: model.capabilities || [],
    requires_confirmation: false,
    non_commercial: model.license?.includes("NC") ?? false,
    detail: model.detail,
    actions: [],
  }));
}

function actionLabel(action: ModelPackAction) {
  if (action === "install") return "Install";
  if (action === "update") return "Update";
  return "Remove";
}

export function ModelPackManager(props: {
  models: LocalModelInfo[];
  error: string | null;
  apiUrl: string;
  onRefresh: () => void;
}) {
  const { apiUrl, error: modelError, models, onRefresh } = props;
  const [packs, setPacks] = useState<ModelPackInfo[]>([]);
  const [jobs, setJobs] = useState<BackgroundJob[]>([]);
  const [busyPackId, setBusyPackId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);

  const effectivePacks = packs.length > 0 ? packs : fallbackPacks(models);
  const activeJobs = jobs.filter((job) => !TERMINAL.has(job.status));
  const ready = effectivePacks.filter((pack) => pack.status === "ready").length;

  const grouped = useMemo(
    () =>
      effectivePacks.reduce<Record<ModelPackInfo["category"], ModelPackInfo[]>>(
        (acc, pack) => {
          acc[pack.category].push(pack);
          return acc;
        },
        { tts: [], asr: [], translation: [] }
      ),
    [effectivePacks]
  );

  const loadModelPacks = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await apiFetch(`${apiUrl}/api/model-packs`, { signal });
      if (!res.ok) throw new Error(await readApiError(res));
      const data = (await res.json()) as ModelPacksResponse;
      setPacks(data.packs || []);
      setJobs(data.jobs || []);
      setError(null);
    } catch (exc) {
      if (signal?.aborted) return;
      setError(exc instanceof Error ? exc.message : "Could not load model packs.");
    }
  }, [apiUrl]);

  useEffect(() => {
    const controller = new AbortController();
    void loadModelPacks(controller.signal);
    return () => controller.abort();
  }, [loadModelPacks]);

  useEffect(() => {
    if (activeJobs.length === 0) return undefined;
    const timer = window.setInterval(() => {
      void loadModelPacks();
      onRefresh();
    }, 1500);
    return () => window.clearInterval(timer);
  }, [activeJobs.length, loadModelPacks, onRefresh]);

  async function runAction(pack: ModelPackInfo, action: ModelPackAction) {
    const risky =
      action === "remove" ||
      pack.requires_confirmation ||
      pack.non_commercial ||
      (pack.disk_size_mb ?? 0) >= 100;
    if (risky) {
      const licenseNote = pack.non_commercial
        ? "\n\nThis pack has a non-commercial license gate."
        : "";
      const ok = window.confirm(
        `${actionLabel(action)} ${pack.name}?${licenseNote}\n\nPath: ${
          pack.installed_path || "configured by backend"
        }`
      );
      if (!ok) return;
    }

    setBusyPackId(pack.id);
    setMessage("");
    setError(null);
    try {
      const url =
        action === "remove"
          ? `${apiUrl}/api/model-packs/${pack.id}`
          : `${apiUrl}/api/model-packs/${pack.id}/${action}`;
      const res = await apiFetch(url, { method: action === "remove" ? "DELETE" : "POST" });
      if (!res.ok) throw new Error(await readApiError(res));
      const job = (await res.json()) as BackgroundJob;
      setJobs((current) => [job, ...current.filter((candidate) => candidate.id !== job.id)]);
      setMessage(job.message || `${actionLabel(action)} queued.`);
      window.setTimeout(() => void loadModelPacks(), 800);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Could not start model-pack action.");
    } finally {
      setBusyPackId("");
    }
  }

  async function cancelJob(job: BackgroundJob) {
    const res = await apiFetch(`${apiUrl}/api/model-packs/jobs/${job.id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      const updated = (await res.json()) as BackgroundJob;
      setJobs((current) =>
        current.map((candidate) => (candidate.id === updated.id ? updated : candidate))
      );
    }
  }

  return (
    <section className="space-y-4" aria-labelledby="model-pack-manager-heading">
      <div className="rounded border border-slate-300 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Local runtime</p>
            <h2 id="model-pack-manager-heading" className="text-lg font-semibold">
              Model Pack Manager
            </h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="rounded border border-slate-200 px-3 py-1 text-sm" aria-live="polite">
              {ready}/{effectivePacks.length} ready
            </span>
            <button
              type="button"
              className="rounded border border-slate-300 px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
              onClick={() => {
                void loadModelPacks();
                onRefresh();
              }}
            >
              Refresh
            </button>
          </div>
        </div>
        <p className="mt-2 text-sm text-slate-600">
          Safe actions are backend-defined; the UI never runs arbitrary shell commands.
        </p>
        {(modelError || error) && (
          <p className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            {error || modelError}
          </p>
        )}
        {message && (
          <p className="mt-3 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700" role="status">
            {message}
          </p>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {WORKFLOW_UNLOCKS.map((workflow) => {
          const tally = modelReadiness(effectivePacks, workflow.match);
          return (
            <div key={workflow.label} className="rounded border border-slate-300 bg-white p-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-medium">{workflow.label}</h3>
                <span className="text-xs text-slate-500">
                  {tally.ready}/{tally.total || 0}
                </span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded bg-slate-100">
                <div
                  className="h-full bg-emerald-600"
                  style={{
                    width:
                      tally.total > 0 ? `${Math.round((tally.ready / tally.total) * 100)}%` : "0%",
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {jobs.length > 0 && (
        <section className="rounded border border-slate-300 bg-white p-4" aria-label="Model-pack jobs">
          <h3 className="font-semibold">Recent jobs</h3>
          <div className="mt-3 space-y-2">
            {jobs.slice(0, 5).map((job) => (
              <div key={job.id} className="rounded border border-slate-200 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{job.kind}</span>
                  <span className={`rounded border px-2 py-1 text-xs ${statusClass(job.status)}`}>
                    {job.status}
                  </span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded bg-slate-100">
                  <div className="h-full bg-blue-600" style={{ width: `${job.progress}%` }} />
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-slate-600">{job.error || job.message}</p>
                  {!TERMINAL.has(job.status) && (
                    <button
                      type="button"
                      className="rounded border border-amber-300 px-2 py-1 text-xs text-amber-800 focus:outline-none focus:ring-2 focus:ring-amber-400"
                      onClick={() => void cancelJob(job)}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {(["tts", "asr", "translation"] as const).map((category) => (
        <section key={category} className="rounded border border-slate-300 bg-white p-4">
          <h3 className="font-semibold capitalize">{category} packs</h3>
          <div className="mt-3 grid gap-3 xl:grid-cols-2">
            {grouped[category].map((pack) => (
              <article key={pack.id} className="rounded border border-slate-200 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h4 className="font-medium">{pack.name}</h4>
                    <p className="text-xs text-slate-500">
                      {pack.provider} / {pack.version} / {pack.license || "local"}
                    </p>
                  </div>
                  <span className={`rounded border px-2 py-1 text-xs ${statusClass(pack.status)}`}>
                    {pack.status.replace("_", " ")}
                  </span>
                </div>
                <dl className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
                  <div>
                    <dt className="font-medium text-slate-700">Disk</dt>
                    <dd>{pack.disk_size_mb ? `${pack.disk_size_mb} MB` : "provider managed"}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-700">Checksum</dt>
                    <dd>{pack.checksum || "provider manifest"}</dd>
                  </div>
                </dl>
                {pack.installed_path && (
                  <p className="mt-2 break-all text-xs text-slate-500">Path: {pack.installed_path}</p>
                )}
                {pack.languages.length > 0 && (
                  <p className="mt-2 text-xs text-slate-600">
                    Languages: {pack.languages.slice(0, 8).join(", ")}
                    {pack.languages.length > 8 ? ` +${pack.languages.length - 8}` : ""}
                  </p>
                )}
                {pack.non_commercial && (
                  <p className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">
                    Non-commercial license gate. Confirm eligibility before installing.
                  </p>
                )}
                {pack.detail && <p className="mt-2 text-sm text-slate-700">{pack.detail}</p>}
                <div className="mt-3 flex flex-wrap gap-2">
                  {pack.actions.map((action) => (
                    <button
                      type="button"
                      key={action}
                      className={`rounded border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:opacity-50 ${
                        action === "remove"
                          ? "border-red-300 text-red-700"
                          : "border-slate-300 text-slate-800"
                      }`}
                      disabled={busyPackId === pack.id || activeJobs.some((job) => job.kind.endsWith(`:${pack.id}`))}
                      onClick={() => void runAction(pack, action)}
                    >
                      {actionLabel(action)}
                    </button>
                  ))}
                  {pack.actions.length === 0 && (
                    <span className="rounded border border-slate-200 px-3 py-2 text-sm text-slate-500">
                      Manual pack
                    </span>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
    </section>
  );
}
