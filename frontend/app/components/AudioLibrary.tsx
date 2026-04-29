import type { AudioAsset } from "../lib/workspace";
import { downloadBlob } from "../lib/clientUtils";

export function AudioLibrary(props: {
  assets: AudioAsset[];
  audioUrls: Record<string, string>;
  onDelete: (id: string) => void;
}) {
  return (
    <section className="space-y-3" aria-labelledby="audio-library-heading">
      <div>
        <h2 id="audio-library-heading" className="text-lg font-semibold">Audio Library</h2>
        <p className="text-sm text-slate-500">
          {props.assets.length} local clips in this project
        </p>
      </div>
      {props.assets.map((asset) => (
        <article key={asset.id} className="rounded border border-slate-300 p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <button
              type="button"
              className="max-w-xl text-left text-sm font-medium focus:outline-none focus:ring-2 focus:ring-slate-400"
              aria-label={`Download ${asset.name}.${asset.format}`}
              onClick={() =>
                props.audioUrls[asset.id] &&
                downloadBlob(asset.blob, `${asset.name}.${asset.format}`)
              }
            >
              {asset.text}
            </button>
            <button
              type="button"
              className="rounded border border-red-300 px-2 py-1 text-xs text-red-700 focus:outline-none focus:ring-2 focus:ring-red-400"
              aria-label={`Delete clip: ${asset.name}`}
              onClick={() => props.onDelete(asset.id)}
            >
              Delete
            </button>
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
