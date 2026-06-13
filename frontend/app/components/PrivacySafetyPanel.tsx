import type { ClonedVoiceInfo, LocalModelInfo } from "../lib/types";
import type { AudioAsset } from "../lib/workspace";

function countReady(models: LocalModelInfo[], category: LocalModelInfo["category"]) {
  return models.filter((model) => model.category === category && model.status === "ready").length;
}

export function PrivacySafetyPanel(props: {
  apiUrl: string;
  clones: ClonedVoiceInfo[];
  assets: AudioAsset[];
  models: LocalModelInfo[];
  onExportConsentLedger: () => void;
}) {
  const cloneConsentCount = props.clones.filter((clone) => clone.consent_confirmed).length;
  const generatedBytes = props.assets.reduce((total, asset) => total + asset.bytes, 0);
  const localOnly = props.apiUrl.includes("127.0.0.1") || props.apiUrl.includes("localhost");

  return (
    <section className="rounded border border-slate-300 bg-white p-4" aria-labelledby="privacy-safety-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Offline assurance</p>
          <h2 id="privacy-safety-heading" className="text-lg font-semibold">
            Privacy and Safety
          </h2>
        </div>
        <span
          className={`rounded border px-3 py-1 text-sm ${
            localOnly
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-amber-200 bg-amber-50 text-amber-800"
          }`}
        >
          {localOnly ? "Localhost API" : "Network API"}
        </span>
        <button
          type="button"
          className="rounded border border-slate-300 px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          onClick={props.onExportConsentLedger}
        >
          Export Ledger
        </button>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded border border-slate-200 p-3">
          <p className="text-xs uppercase text-slate-500">Generated library</p>
          <p className="mt-1 text-lg font-semibold">{props.assets.length}</p>
          <p className="text-xs text-slate-500">{(generatedBytes / 1024 / 1024).toFixed(2)} MB local</p>
        </div>
        <div className="rounded border border-slate-200 p-3">
          <p className="text-xs uppercase text-slate-500">Cloned voices</p>
          <p className="mt-1 text-lg font-semibold">{props.clones.length}</p>
          <p className="text-xs text-slate-500">{cloneConsentCount} consent-confirmed</p>
        </div>
        <div className="rounded border border-slate-200 p-3">
          <p className="text-xs uppercase text-slate-500">ASR packs</p>
          <p className="mt-1 text-lg font-semibold">{countReady(props.models, "asr")}</p>
          <p className="text-xs text-slate-500">ready locally</p>
        </div>
        <div className="rounded border border-slate-200 p-3">
          <p className="text-xs uppercase text-slate-500">Translation packs</p>
          <p className="mt-1 text-lg font-semibold">{countReady(props.models, "translation")}</p>
          <p className="text-xs text-slate-500">ready locally</p>
        </div>
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div className="rounded border border-slate-200 p-3">
          <h3 className="font-medium">Consent ledger</h3>
          <div className="mt-2 space-y-2">
            {props.clones.map((clone) => (
              <div key={clone.id} className="rounded border border-slate-200 px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{clone.name}</span>
                  <span
                    className={`rounded border px-2 py-1 text-xs ${
                      clone.consent_confirmed
                        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                        : "border-amber-200 bg-amber-50 text-amber-800"
                    }`}
                  >
                    {clone.consent_confirmed ? "consent confirmed" : "needs review"}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {clone.language || "custom"} / {clone.engine} / {clone.created_at.slice(0, 10)}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Allowed uses: set per-project notes until clone-level policies are exposed.
                </p>
              </div>
            ))}
            {props.clones.length === 0 && (
              <p className="text-sm text-slate-500">No cloned voices in the local ledger yet.</p>
            )}
          </div>
        </div>
        <div className="rounded border border-slate-200 p-3">
          <h3 className="font-medium">Provenance posture</h3>
          <ul className="mt-2 space-y-1 text-sm text-slate-600">
            <li>Desktop uses a loopback backend URL by default.</li>
            <li>Set an API key before exposing Docker or backend ports on a LAN.</li>
            <li>Dubbing WAV export writes a companion provenance JSON sidecar.</li>
            <li>Generated audio and projects stay in IndexedDB or the local audio folder.</li>
            <li>C2PA-compatible embedding is tracked as a future packaging enhancement.</li>
          </ul>
        </div>
      </div>
    </section>
  );
}
