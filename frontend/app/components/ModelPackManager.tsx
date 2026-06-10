import { useState } from "react";

import { apiFetch, readApiError } from "../lib/api";
import type { LocalModelInfo } from "../lib/types";

const WORKFLOW_UNLOCKS = [
  {
    label: "Text to speech",
    match: (model: LocalModelInfo) => model.category === "tts",
  },
  {
    label: "Voice cloning",
    match: (model: LocalModelInfo) => model.capabilities?.includes("voice-clone") ?? false,
  },
  {
    label: "Dictation and ASR",
    match: (model: LocalModelInfo) => model.category === "asr",
  },
  {
    label: "Offline translation",
    match: (model: LocalModelInfo) => model.category === "translation",
  },
];

const INSTALL_HINTS: Record<string, string[]> = {
  "kokoro-v1-onnx": ["cd backend", "python scripts/download_models.py"],
  "chatterbox-local": [
    "cd backend",
    "pip install torch==2.6.0+cpu torchaudio==2.6.0+cpu --index-url https://download.pytorch.org/whl/cpu",
    "pip install -r requirements-clone.txt",
    "pip install --no-deps chatterbox-tts==0.1.7",
  ],
  "supertonic-3-onnx": [
    "cd backend",
    "pip install -r requirements-supertonic.txt",
    "pip install --no-deps supertonic",
    "python scripts/download_models.py --supertonic",
  ],
  "faster-whisper": [
    "cd backend",
    "pip install -r requirements-local-models.txt",
    "set FASTER_WHISPER_MODEL_DIR=<local-model-folder>",
  ],
  vosk: [
    "cd backend",
    "pip install -r requirements-local-models.txt",
    "set VOSK_MODEL_DIR=<local-vosk-model-folder>",
  ],
  "whisper-cpp": [
    "set WHISPER_CPP_BINARY=<path-to-whisper-cli>",
    "set WHISPER_CPP_MODEL_FILE=<path-to-ggml-model>",
  ],
  "argos-translate": [
    "cd backend",
    "pip install -r requirements-local-models.txt",
    "set ARGOS_PACKAGES_DIR=<local-argos-packages-folder>",
  ],
  indictrans2: [
    "cd backend",
    "pip install -r requirements-local-models.txt",
    "set INDICTRANS2_MODEL_DIR=<local-indictrans2-checkpoint-folder>",
  ],
  "nllb-200": [
    "set ENABLE_NLLB=1",
    "set NLLB_MODEL_DIR=<local-nllb-model-folder>",
  ],
};

function statusClass(status: LocalModelInfo["status"]) {
  if (status === "ready") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "disabled") return "border-amber-200 bg-amber-50 text-amber-800";
  if (status === "error") return "border-red-200 bg-red-50 text-red-800";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function modelReadiness(models: LocalModelInfo[], match: (model: LocalModelInfo) => boolean) {
  const matched = models.filter(match);
  const ready = matched.filter((model) => model.status === "ready").length;
  return { ready, total: matched.length };
}

export function ModelPackManager(props: {
  models: LocalModelInfo[];
  error: string | null;
  apiUrl: string;
  onRefresh: () => void;
}) {
  const [provisioning, setProvisioning] = useState(false);
  const [message, setMessage] = useState("");
  const ready = props.models.filter((model) => model.status === "ready").length;
  const grouped = props.models.reduce<Record<LocalModelInfo["category"], LocalModelInfo[]>>(
    (acc, model) => {
      acc[model.category].push(model);
      return acc;
    },
    { tts: [], asr: [], translation: [] }
  );

  async function provisionKokoro() {
    setProvisioning(true);
    setMessage("");
    try {
      const res = await apiFetch(`${props.apiUrl}/api/setup/provision-models`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(await readApiError(res));
      setMessage("Kokoro download started. Refreshing inventory shortly.");
      window.setTimeout(props.onRefresh, 1500);
    } catch (exc) {
      setMessage(exc instanceof Error ? exc.message : "Could not start model download.");
    } finally {
      setProvisioning(false);
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
          <span className="rounded border border-slate-200 px-3 py-1 text-sm" aria-live="polite">
            {ready}/{props.models.length} ready
          </span>
        </div>
        <p className="mt-2 text-sm text-slate-600">
          API inventory: {props.apiUrl}/api/local-models
        </p>
        {props.error && (
          <p className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            {props.error}
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
          const tally = modelReadiness(props.models, workflow.match);
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

      {(["tts", "asr", "translation"] as const).map((category) => (
        <section key={category} className="rounded border border-slate-300 bg-white p-4">
          <h3 className="font-semibold capitalize">{category} packs</h3>
          <div className="mt-3 grid gap-3 xl:grid-cols-2">
            {grouped[category].map((model) => {
              const commands = INSTALL_HINTS[model.id] || [];
              return (
                <article key={model.id} className="rounded border border-slate-200 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h4 className="font-medium">{model.name}</h4>
                      <p className="text-xs text-slate-500">
                        {model.provider} / {model.license || "local"}
                      </p>
                    </div>
                    <span className={`rounded border px-2 py-1 text-xs ${statusClass(model.status)}`}>
                      {model.status.replace("_", " ")}
                    </span>
                  </div>
                  {model.path && (
                    <p className="mt-2 break-all text-xs text-slate-500">Path: {model.path}</p>
                  )}
                  {model.languages && model.languages.length > 0 && (
                    <p className="mt-2 text-xs text-slate-600">
                      Languages: {model.languages.slice(0, 8).join(", ")}
                      {model.languages.length > 8 ? ` +${model.languages.length - 8}` : ""}
                    </p>
                  )}
                  {model.detail && <p className="mt-2 text-sm text-slate-700">{model.detail}</p>}
                  {commands.length > 0 && model.status !== "ready" && (
                    <pre className="mt-3 overflow-x-auto rounded bg-slate-950 p-3 text-xs text-slate-100">
                      {commands.join("\n")}
                    </pre>
                  )}
                  {model.id === "kokoro-v1-onnx" && model.status !== "ready" && (
                    <button
                      type="button"
                      className="mt-3 rounded bg-slate-950 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:opacity-50"
                      disabled={provisioning}
                      onClick={() => void provisionKokoro()}
                    >
                      {provisioning ? "Starting..." : "Download Kokoro Pack"}
                    </button>
                  )}
                </article>
              );
            })}
            {grouped[category].length === 0 && (
              <p className="text-sm text-slate-500">No {category} packs reported.</p>
            )}
          </div>
        </section>
      ))}
    </section>
  );
}
