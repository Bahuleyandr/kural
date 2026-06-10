import { useEffect, useState } from "react";

import {
  DEFAULT_DICTATION_SETTINGS,
  loadDictationSettings,
  saveDictationSettings,
  type DictationSettings,
} from "../lib/dictationSettings";

export function DictationSettingsPanel() {
  const [settings, setSettings] = useState<DictationSettings>(DEFAULT_DICTATION_SETTINGS);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setSettings(loadDictationSettings());
  }, []);

  function update(next: DictationSettings) {
    setSettings(next);
    saveDictationSettings(next);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1200);
  }

  return (
    <section className="rounded border border-slate-300 bg-white p-4" aria-labelledby="dictation-settings-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Daily capture</p>
          <h2 id="dictation-settings-heading" className="text-lg font-semibold">
            Dictation Settings
          </h2>
        </div>
        <span className="text-sm text-slate-500" aria-live="polite">
          {saved ? "Saved" : "Local only"}
        </span>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="text-sm font-medium">
          ASR language hint
          <input
            className="mt-2 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
            value={settings.language}
            onChange={(event) => update({ ...settings, language: event.target.value })}
            placeholder="auto, en-US, hi-IN"
          />
        </label>
        <div className="rounded border border-slate-200 p-3 text-sm text-slate-600">
          Shortcut: Ctrl+Shift+Space on Windows/Linux, Cmd+Shift+Space on macOS.
        </div>
      </div>
      <div className="mt-4 grid gap-2 md:grid-cols-2">
        {[
          ["autoPaste", "Copy transcript and hide widget when stopped"],
          ["pushToTalk", "Hold the dictation button to record"],
          ["echoCancellation", "Use browser echo cancellation"],
          ["noiseSuppression", "Use browser noise suppression"],
          ["insertTrailingSpace", "Append a trailing space after dictation"],
        ].map(([key, label]) => (
          <label key={key} className="flex items-center gap-2 rounded border border-slate-200 p-3 text-sm">
            <input
              type="checkbox"
              checked={Boolean(settings[key as keyof DictationSettings])}
              onChange={(event) =>
                update({ ...settings, [key]: event.target.checked } as DictationSettings)
              }
            />
            {label}
          </label>
        ))}
      </div>
    </section>
  );
}
