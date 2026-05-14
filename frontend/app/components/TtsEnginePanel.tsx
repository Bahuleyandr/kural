import type { LocalModelInfo } from "../lib/types";

const STATUS_STYLES: Record<string, string> = {
  ready: "bg-emerald-100 text-emerald-800",
  not_configured: "bg-amber-100 text-amber-800",
  not_installed: "bg-slate-100 text-slate-700",
  disabled: "bg-slate-100 text-slate-700",
  error: "bg-red-100 text-red-800",
};

/**
 * Settings view for the TTS engines. The backend already inventories
 * Kokoro / Chatterbox / Supertonic as `category: "tts"` entries on
 * `/api/local-models`; LocalModelPanel filters those out (it only shows
 * the ASR/translation workflow models), so this panel is what actually
 * surfaces engine install + provisioning status to the user.
 */
export function TtsEnginePanel(props: { models: LocalModelInfo[]; error: string | null }) {
  const engines = props.models
    .filter((model) => model.category === "tts")
    .map((model) => ({ ...model, languages: model.languages ?? [] }));
  const ready = engines.filter((model) => model.status === "ready").length;

  return (
    <section className="rounded border border-slate-300 p-3" aria-labelledby="tts-engines-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="tts-engines-heading" className="font-semibold">
          TTS Engines
        </h2>
        <span className="text-xs uppercase text-slate-500" aria-live="polite">
          {ready}/{engines.length} ready
        </span>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {engines.map((engine) => (
          <div key={engine.id} className="rounded border border-slate-200 px-3 py-2 text-sm">
            <div className="flex items-start justify-between gap-2">
              <span className="font-medium">{engine.name}</span>
              <span
                className={`rounded px-2 py-0.5 text-xs ${
                  STATUS_STYLES[engine.status] ?? STATUS_STYLES.not_installed
                }`}
              >
                {engine.status.replace(/_/g, " ")}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {engine.provider} / {engine.license || "local"}
            </p>
            {engine.languages.length > 0 && (
              <p className="mt-1 text-xs text-slate-600">
                {engine.languages.slice(0, 6).join(", ")}
                {engine.languages.length > 6 ? ` +${engine.languages.length - 6}` : ""}
              </p>
            )}
            {engine.detail && (
              <p className="mt-1 text-xs text-slate-600">{engine.detail}</p>
            )}
          </div>
        ))}
      </div>
      {props.error && (
        <p className="mt-2 text-sm text-red-700" role="alert">
          {props.error}
        </p>
      )}
      {engines.length === 0 && (
        <p className="mt-2 text-sm text-slate-500">No TTS engines reported.</p>
      )}
    </section>
  );
}
