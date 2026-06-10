import type { ClonedVoiceInfo, LocalModelInfo } from "../lib/types";
import type { AudioAsset, KuralProject } from "../lib/workspace";
import { DictationSettingsPanel } from "./DictationSettingsPanel";
import { PrivacySafetyPanel } from "./PrivacySafetyPanel";
import { ProjectVaultPanel } from "./ProjectVaultPanel";
import { ReleaseDiagnosticsPanel } from "./ReleaseDiagnosticsPanel";

export function SettingsView(props: {
  apiUrl: string;
  backendStatus: string | null;
  backendError: string | null;
  clones: ClonedVoiceInfo[];
  assets: AudioAsset[];
  models: LocalModelInfo[];
  projects: KuralProject[];
  activeProject: KuralProject | null;
  onUpdateProject: (fields: Partial<KuralProject>) => void;
}) {
  return (
    <div className="space-y-4">
      <DictationSettingsPanel />
      <ProjectVaultPanel
        activeProject={props.activeProject}
        assets={props.assets}
        projects={props.projects}
        onUpdateProject={props.onUpdateProject}
      />
      <ReleaseDiagnosticsPanel
        apiUrl={props.apiUrl}
        backendStatus={props.backendStatus}
        backendError={props.backendError}
      />
      <PrivacySafetyPanel
        apiUrl={props.apiUrl}
        clones={props.clones}
        assets={props.assets}
        models={props.models}
      />
    </div>
  );
}
