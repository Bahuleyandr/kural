import type { ClonedVoiceInfo, LocalModelInfo } from "../lib/types";
import type { AudioAsset } from "../lib/workspace";
import { DictationSettingsPanel } from "./DictationSettingsPanel";
import { PrivacySafetyPanel } from "./PrivacySafetyPanel";
import { ReleaseDiagnosticsPanel } from "./ReleaseDiagnosticsPanel";

export function SettingsView(props: {
  apiUrl: string;
  backendStatus: string | null;
  backendError: string | null;
  clones: ClonedVoiceInfo[];
  assets: AudioAsset[];
  models: LocalModelInfo[];
}) {
  return (
    <div className="space-y-4">
      <DictationSettingsPanel />
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
