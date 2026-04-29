import type { LocalModelInfo } from "../lib/types";

export function LocalModelPanel(props: { models: LocalModelInfo[]; error: string | null }) {
  const workflowModels = props.models.filter(
    (model) => model.category === "asr" || model.category === "translation"
  );
  const ready = workflowModels.filter((model) => model.status === "ready").length;
  return (
    <section className="rounded border border-slate-300 p-3" aria-labelledby="local-models-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="local-models-heading" className="font-semibold">Local Models</h2>
        <span className="text-xs uppercase text-slate-500" aria-live="polite">
          {ready}/{workflowModels.length} ready
        </span>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {workflowModels.map((model) => (
          <div key={model.id} className="rounded border border-slate-200 px-3 py-2 text-sm">
            <div className="flex items-start justify-between gap-2">
              <span className="font-medium">{model.name}</span>
              <span
                className={`rounded px-2 py-0.5 text-xs ${
                  model.status === "ready"
                    ? "bg-emerald-100 text-emerald-800"
                    : model.status === "disabled"
                      ? "bg-amber-100 text-amber-800"
                      : "bg-slate-100 text-slate-700"
                }`}
              >
                {model.status.replace("_", " ")}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {model.provider} / {model.license || "local"}
            </p>
            {model.detail && <p className="mt-1 text-xs text-slate-600">{model.detail}</p>}
          </div>
        ))}
      </div>
      {props.error && (
        <p className="mt-2 text-sm text-red-700" role="alert">
          {props.error}
        </p>
      )}
      {workflowModels.length === 0 && (
        <p className="mt-2 text-sm text-slate-500">No local model adapters reported.</p>
      )}
    </section>
  );
}
