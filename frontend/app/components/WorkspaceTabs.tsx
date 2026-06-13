import type { WorkspaceView } from "../lib/types";

const WORKSPACE_VIEWS: WorkspaceView[] = [
  "write",
  "quality",
  "voices",
  "models",
  "dubbing",
  "pronunciation",
  "agent",
  "library",
  "settings",
];

export function WorkspaceTabs(props: {
  activeView: WorkspaceView;
  onViewChange: (view: WorkspaceView) => void;
}) {
  return (
    <nav className="flex flex-wrap gap-2" aria-label="Workspace views">
      {WORKSPACE_VIEWS.map((view) => (
        <button
          type="button"
          key={view}
          aria-pressed={props.activeView === view}
          className={`rounded border px-3 py-2 text-sm capitalize focus:outline-none focus:ring-2 focus:ring-slate-400 ${
            props.activeView === view
              ? "border-slate-950 bg-slate-950 text-white"
              : "border-slate-300"
          }`}
          onClick={() => props.onViewChange(view)}
        >
          {view}
        </button>
      ))}
    </nav>
  );
}
