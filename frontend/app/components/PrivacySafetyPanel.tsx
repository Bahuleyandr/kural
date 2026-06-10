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
          <h3 className="font-medium">Clone guardrails</h3>
          <ul className="mt-2 space-y-1 text-sm text-slate-600">
            <li>Consent confirmation is required before clone creation.</li>
            <li>Accepted clone samples are logged with a SHA-256 sample fingerprint.</li>
            <li>Clone archives stay local unless the user exports them manually.</li>
          </ul>
        </div>
        <div className="rounded border border-slate-200 p-3">
          <h3 className="font-medium">Network posture</h3>
          <ul className="mt-2 space-y-1 text-sm text-slate-600">
            <li>Desktop uses a loopback backend URL by default.</li>
            <li>Set an API key before exposing Docker or backend ports on a LAN.</li>
            <li>Generated audio and projects stay in IndexedDB or the local audio folder.</li>
          </ul>
        </div>
      </div>
    </section>
  );
}
