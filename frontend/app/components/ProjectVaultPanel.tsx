import type { KuralProject, AudioAsset } from "../lib/workspace";

function bytes(value: number) {
  if (value > 1024 * 1024) return `${(value / 1024 / 1024).toFixed(2)} MB`;
  return `${Math.max(1, Math.round(value / 1024))} KB`;
}

export function ProjectVaultPanel(props: {
  projects: KuralProject[];
  activeProject: KuralProject | null;
  assets: AudioAsset[];
  onUpdateProject: (fields: Partial<KuralProject>) => void;
}) {
  const totalBytes = props.assets.reduce((total, asset) => total + asset.bytes, 0);
  const activeTags = props.activeProject?.tags?.join(", ") || "";

  return (
    <section className="rounded border border-slate-300 bg-white p-4" aria-labelledby="project-vault-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Local project vault</p>
          <h2 id="project-vault-heading" className="text-lg font-semibold">Project Vault</h2>
        </div>
        <span className="rounded border border-slate-200 px-3 py-1 text-sm">
          {props.projects.length} project{props.projects.length === 1 ? "" : "s"}
        </span>
      </div>
      <p className="mt-2 text-sm text-slate-600">
        Browser and Docker builds use IndexedDB. Desktop Public Beta keeps the vault local and
        exports portable `.kuralproj` archives with project metadata and audio assets.
      </p>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="rounded border border-slate-200 p-3">
          <p className="text-xs uppercase text-slate-500">Active assets</p>
          <p className="mt-1 text-lg font-semibold">{props.assets.length}</p>
          <p className="text-xs text-slate-500">{bytes(totalBytes)}</p>
        </div>
        <div className="rounded border border-slate-200 p-3">
          <p className="text-xs uppercase text-slate-500">Archived</p>
          <p className="mt-1 text-lg font-semibold">
            {props.projects.filter((project) => project.archived).length}
          </p>
          <p className="text-xs text-slate-500">hidden from day-to-day work later</p>
        </div>
        <div className="rounded border border-slate-200 p-3">
          <p className="text-xs uppercase text-slate-500">Portable</p>
          <p className="mt-1 text-lg font-semibold">.kuralproj</p>
          <p className="text-xs text-slate-500">zip manifest plus audio</p>
        </div>
      </div>

      {props.activeProject && (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <label className="text-sm">
            Tags
            <input
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-400"
              value={activeTags}
              onChange={(event) =>
                props.onUpdateProject({
                  tags: event.target.value
                    .split(",")
                    .map((tag) => tag.trim())
                    .filter(Boolean),
                })
              }
              placeholder="podcast, hindi, draft"
            />
          </label>
          <label className="flex items-center gap-2 self-end rounded border border-slate-300 px-3 py-2 text-sm">
            <input
              type="checkbox"
              checked={props.activeProject.archived}
              onChange={(event) => props.onUpdateProject({ archived: event.target.checked })}
            />
            Archive this project
          </label>
        </div>
      )}
    </section>
  );
}
