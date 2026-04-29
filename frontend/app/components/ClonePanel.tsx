import { type ChangeEvent } from "react";

import type { ClonedVoiceInfo } from "../lib/types";

export function ClonePanel(props: {
  cloneBusy: boolean;
  cloneConsent: boolean;
  cloneLanguage: string;
  cloneMessage: string;
  cloneName: string;
  clones: ClonedVoiceInfo[];
  onCloneConsentChange: (value: boolean) => void;
  onCloneExport: () => void;
  onCloneFileChange: (value: File | null) => void;
  onCloneImport: (event: ChangeEvent<HTMLInputElement>) => void;
  onCloneLanguageChange: (value: string) => void;
  onCloneNameChange: (value: string) => void;
  onCloneUpload: () => void;
  onDeleteClone: (id: string) => void;
}) {
  return (
    <section className="rounded border border-slate-300 p-3" aria-labelledby="clone-heading">
      <h2 id="clone-heading" className="font-semibold">Clone a Voice</h2>
      <div className="mt-3 space-y-3">
        <label className="block text-sm">
          Audio sample
          <input
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
            type="file"
            accept="audio/*"
            onChange={(event) => props.onCloneFileChange(event.target.files?.[0] ?? null)}
          />
        </label>
        <label className="block text-sm">
          Voice name
          <input
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-400"
            value={props.cloneName}
            onChange={(event) => props.onCloneNameChange(event.target.value)}
          />
        </label>
        <label className="block text-sm">
          Language
          <input
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-400"
            value={props.cloneLanguage}
            onChange={(event) => props.onCloneLanguageChange(event.target.value)}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={props.cloneConsent}
            onChange={(event) => props.onCloneConsentChange(event.target.checked)}
          />
          I have consent to clone and use this voice.
        </label>
        <button
          type="button"
          className="rounded bg-slate-950 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:opacity-50"
          disabled={props.cloneBusy}
          onClick={props.onCloneUpload}
          aria-busy={props.cloneBusy}
        >
          {props.cloneBusy ? "Cloning..." : "Clone Voice"}
        </button>
        {props.cloneMessage && (
          <p className="text-sm text-slate-700" role="status" aria-live="polite">
            {props.cloneMessage}
          </p>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          onClick={props.onCloneExport}
        >
          Export Voices
        </button>
        <label className="cursor-pointer rounded border border-slate-300 px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-slate-400">
          Import Voices
          <input
            id="clone-archive-file"
            className="hidden"
            type="file"
            accept=".zip"
            onChange={props.onCloneImport}
          />
        </label>
      </div>

      <div className="mt-4 space-y-2">
        {props.clones.map((clone) => (
          <div key={clone.id} className="rounded border border-slate-200 px-3 py-2 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span>
                {clone.name} {clone.language ? `(${clone.language})` : ""}
              </span>
              <button
                type="button"
                className="rounded border border-red-300 px-2 py-1 text-xs text-red-700 focus:outline-none focus:ring-2 focus:ring-red-400"
                aria-label={`Delete cloned voice: ${clone.name}`}
                onClick={() => props.onDeleteClone(clone.id)}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
        {props.clones.length === 0 && (
          <p className="text-sm text-slate-500">No cloned voices yet.</p>
        )}
      </div>
    </section>
  );
}
