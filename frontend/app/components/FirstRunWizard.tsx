"use client";

import { useEffect, useMemo, useState } from "react";

import { clearSetupState, restartLocalBackend } from "../lib/api";
import type { ClonedVoiceInfo, LocalModelInfo } from "../lib/types";

const DISMISS_KEY = "kural.firstRunWizard.dismissed.v1";

function ready(models: LocalModelInfo[], provider: string) {
  return models.some((model) => model.provider === provider && model.status === "ready");
}

export function FirstRunWizard(props: {
  backendStatus: string | null;
  backendError: string;
  models: LocalModelInfo[];
  clones: ClonedVoiceInfo[];
  onOpenModels: () => void;
  onCreateSampleProject: () => void;
  onRefresh: () => void;
}) {
  const [dismissed, setDismissed] = useState(true);
  const [micStatus, setMicStatus] = useState("Not checked");
  const [repairStatus, setRepairStatus] = useState("");

  useEffect(() => {
    setDismissed(window.localStorage.getItem(DISMISS_KEY) === "true");
  }, []);

  const checklist = useMemo(
    () => [
      {
        label: "Local engine",
        ok: Boolean(props.backendStatus),
        detail: props.backendStatus
          ? `Running: ${props.backendStatus}`
          : props.backendError || "Kural is starting its local engine on this computer.",
      },
      {
        label: "Kokoro voice pack",
        ok: ready(props.models, "kokoro"),
        detail: ready(props.models, "kokoro")
          ? "Starter TTS is ready."
          : "Download the Kokoro pack from Models.",
      },
      {
        label: "Clone runtime",
        ok: ready(props.models, "chatterbox"),
        detail: ready(props.models, "chatterbox")
          ? `${props.clones.length} cloned voice${props.clones.length === 1 ? "" : "s"} available.`
          : "Install the Chatterbox runtime before using cloned voices.",
      },
      {
        label: "Offline dubbing packs",
        ok:
          props.models.some((model) => model.category === "asr" && model.status === "ready") &&
          props.models.some((model) => model.category === "translation" && model.status === "ready"),
        detail: "ASR and translation packs unlock media-first dubbing.",
      },
      {
        label: "Microphone",
        ok: micStatus === "Allowed",
        detail: micStatus,
      },
    ],
    [micStatus, props.backendError, props.backendStatus, props.clones.length, props.models]
  );

  if (dismissed) return null;

  async function requestMic() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicStatus("Microphone capture is not available in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      setMicStatus("Allowed");
    } catch (exc) {
      setMicStatus(exc instanceof Error ? exc.message : "Microphone permission was blocked.");
    }
  }

  function dismiss() {
    window.localStorage.setItem(DISMISS_KEY, "true");
    setDismissed(true);
  }

  async function restartEngine() {
    try {
      const restarted = await restartLocalBackend();
      setRepairStatus(restarted ? "Local engine restarted." : "Restart is available in the desktop app.");
      props.onRefresh();
    } catch (exc) {
      setRepairStatus(exc instanceof Error ? exc.message : "Could not restart the local engine.");
    }
  }

  async function resetSetup() {
    window.localStorage.removeItem(DISMISS_KEY);
    try {
      const cleared = await clearSetupState();
      setRepairStatus(cleared ? "Setup state cleared." : "Setup state reset in this browser.");
    } catch (exc) {
      setRepairStatus(exc instanceof Error ? exc.message : "Could not reset setup state.");
    }
  }

  return (
    <section className="mb-4 rounded border border-emerald-300 bg-white p-4" aria-labelledby="first-run-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-emerald-700">Public Beta setup</p>
          <h2 id="first-run-heading" className="text-lg font-semibold">
            Finish setting up your offline creator workstation
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Kural runs the speech engine locally on this computer. These checks keep the first
            project smooth without sending voice data to a cloud service.
          </p>
        </div>
        <button
          type="button"
          className="rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          onClick={dismiss}
        >
          Dismiss
        </button>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {checklist.map((item) => (
          <div key={item.label} className="rounded border border-slate-200 p-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-medium">{item.label}</h3>
              <span
                className={`rounded border px-2 py-1 text-xs ${
                  item.ok
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : "border-amber-200 bg-amber-50 text-amber-800"
                }`}
              >
                {item.ok ? "Ready" : "Needs setup"}
              </span>
            </div>
            <p className="mt-2 text-xs text-slate-600">{item.detail}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded bg-slate-950 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-slate-400"
          onClick={props.onOpenModels}
        >
          Open Models
        </button>
        <button
          type="button"
          className="rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          onClick={() => void requestMic()}
        >
          Check Microphone
        </button>
        <button
          type="button"
          className="rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          onClick={props.onCreateSampleProject}
        >
          Create Sample Project
        </button>
        <button
          type="button"
          className="rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          onClick={props.onRefresh}
        >
          Check Again
        </button>
        <button
          type="button"
          className="rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          onClick={() => void restartEngine()}
        >
          Restart Engine
        </button>
        <button
          type="button"
          className="rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          onClick={() => void resetSetup()}
        >
          Reset Setup
        </button>
      </div>
      {repairStatus && (
        <p className="mt-3 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700" role="status">
          {repairStatus}
        </p>
      )}
    </section>
  );
}

export function LocalRuntimeStatus(props: {
  backendStatus: string | null;
  backendError: string;
  apiUrl: string;
  onRefresh: () => void;
}) {
  return (
    <div className="mt-4 rounded border border-slate-200 p-3 text-xs text-slate-600" aria-live="polite">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium text-slate-700">Local engine</p>
        <button
          type="button"
          className="rounded border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-slate-400"
          onClick={props.onRefresh}
        >
          Check
        </button>
      </div>
      <p className="mt-2">
        {props.backendStatus
          ? `Running locally: ${props.backendStatus}`
          : "Kural is starting its local engine on this computer."}
      </p>
      <p className="break-all">API: {props.apiUrl}</p>
      {props.backendError && !props.backendStatus && (
        <p className="mt-2 text-red-700" role="alert">
          {props.backendError}
        </p>
      )}
    </div>
  );
}
