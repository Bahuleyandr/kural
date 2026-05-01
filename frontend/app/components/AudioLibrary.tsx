import { useState } from "react";

import type { AudioAsset } from "../lib/workspace";
import { revealSavedFile, saveAudioFileToFolder } from "../lib/api";
import { downloadBlob } from "../lib/clientUtils";

function cleanFileStem(value: string): string {
  const stem = value
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return stem || "kural-audio";
}

function assetFileName(asset: AudioAsset): string {
  return `${cleanFileStem(asset.name || asset.text.slice(0, 48))}.${asset.format}`;
}

export function AudioLibrary(props: {
  assets: AudioAsset[];
  audioUrls: Record<string, string>;
  onDelete: (id: string) => void;
}) {
  const [savedPaths, setSavedPaths] = useState<Record<string, string>>({});
  const [savingAssetId, setSavingAssetId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  async function saveToFolder(asset: AudioAsset) {
    const fileName = assetFileName(asset);
    setSavingAssetId(asset.id);
    setMessage("");

    try {
      const savedPath = await saveAudioFileToFolder(fileName, asset.blob);
      if (!savedPath) {
        downloadBlob(asset.blob, fileName);
        setMessage("Desktop save is unavailable here, so the clip was downloaded instead.");
        return;
      }
      setSavedPaths((current) => ({ ...current, [asset.id]: savedPath }));
      setMessage(`Saved to ${savedPath}`);
    } catch (exc) {
      setMessage(exc instanceof Error ? exc.message : "Could not save this clip.");
    } finally {
      setSavingAssetId(null);
    }
  }

  async function revealPath(path: string) {
    try {
      const opened = await revealSavedFile(path);
      setMessage(opened ? `Opened ${path}` : "Reveal is only available in the desktop app.");
    } catch (exc) {
      setMessage(exc instanceof Error ? exc.message : "Could not reveal this clip.");
    }
  }

  return (
    <section className="space-y-3" aria-labelledby="audio-library-heading">
      <div>
        <h2 id="audio-library-heading" className="text-lg font-semibold">Audio Library</h2>
        <p className="text-sm text-slate-500">
          {props.assets.length} local clips in this project
        </p>
      </div>
      {message && (
        <p className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700" role="status" aria-live="polite">
          {message}
        </p>
      )}
      {props.assets.map((asset) => (
        <article key={asset.id} className="rounded border border-slate-300 p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="max-w-xl text-sm font-medium">
              {asset.text}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-slate-400"
                aria-label={`Download clip: ${asset.name}`}
                onClick={() => downloadBlob(asset.blob, assetFileName(asset))}
              >
                Download
              </button>
              <button
                type="button"
                className="rounded border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:opacity-50"
                aria-label={`Save clip to folder: ${asset.name}`}
                disabled={savingAssetId === asset.id}
                onClick={() => void saveToFolder(asset)}
              >
                {savingAssetId === asset.id ? "Saving..." : "Save to Folder"}
              </button>
              {savedPaths[asset.id] && (
                <button
                  type="button"
                  className="rounded border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-slate-400"
                  aria-label={`Reveal saved clip: ${asset.name}`}
                  onClick={() => void revealPath(savedPaths[asset.id])}
                >
                  Reveal
                </button>
              )}
              <button
                type="button"
                className="rounded border border-red-300 px-2 py-1 text-xs text-red-700 focus:outline-none focus:ring-2 focus:ring-red-400"
                aria-label={`Delete clip: ${asset.name}`}
                onClick={() => props.onDelete(asset.id)}
              >
                Delete
              </button>
            </div>
          </div>
          <p className="mt-1 text-xs uppercase text-slate-500">
            {asset.voiceLabel} / {asset.format.toUpperCase()} / {(asset.bytes / 1024).toFixed(1)} KB
          </p>
          {props.audioUrls[asset.id] && (
            <audio
              className="mt-2 w-full"
              controls
              src={props.audioUrls[asset.id]}
              aria-label={`Audio clip: ${asset.name}`}
            />
          )}
        </article>
      ))}
      {props.assets.length === 0 && (
        <p className="rounded border border-slate-200 p-4 text-sm text-slate-500">No clips yet.</p>
      )}
    </section>
  );
}
