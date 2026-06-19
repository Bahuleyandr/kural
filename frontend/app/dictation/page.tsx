"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { getApiKey, getApiUrl, rehydrateTauriGlobals, wsAuthProtocols } from "../lib/api";
import { DEFAULT_DICTATION_SETTINGS, loadDictationSettings } from "../lib/dictationSettings";
import {
  applyTranscriptFrame,
  floatTo16BitPCM,
  fullTranscript,
  INITIAL_DICTATION_STATE,
  type DictationState,
  type TranscriptFrame,
} from "../lib/dictation";

const SAMPLE_RATE = 16000;

function invokeTauri(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
  type InvokeFn = (c: string, a?: Record<string, unknown>) => Promise<unknown>;
  const w = window as unknown as {
    __TAURI_INTERNALS__?: { invoke?: InvokeFn };
    __TAURI__?: { invoke?: InvokeFn; core?: { invoke?: InvokeFn } };
  };
  // Tauri v2 injects __TAURI_INTERNALS__.invoke regardless of withGlobalTauri.
  const invoke = w.__TAURI_INTERNALS__?.invoke ?? w.__TAURI__?.invoke ?? w.__TAURI__?.core?.invoke;
  if (!invoke) return Promise.reject(new Error("Tauri IPC unavailable"));
  return invoke(cmd, args);
}

/**
 * The dictation widget — a frameless always-on-top window summoned by the
 * global shortcut (Ctrl/Cmd+Shift+Space). It captures the mic, streams
 * PCM to the backend's /api/transcribe/stream WebSocket, shows the live
 * transcript, and on stop hands the text to the `dictation_paste` Tauri
 * command (clipboard + hide).
 *
 * Note: this component is created once at app startup and toggled
 * show/hide, so recording is an explicit user action (mic button) rather
 * than an on-mount side effect.
 */
export default function DictationWidget() {
  const [state, setState] = useState<DictationState>(INITIAL_DICTATION_STATE);
  const [copied, setCopied] = useState(false);
  const [settings, setSettings] = useState(DEFAULT_DICTATION_SETTINGS);

  // Imperative resources live in refs — they outlive React renders and
  // must be torn down deterministically when recording stops.
  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  // Mirror of `state` so the WS message handler can compute the final
  // transcript synchronously without waiting for a React re-render.
  const stateRef = useRef<DictationState>(INITIAL_DICTATION_STATE);

  useEffect(() => {
    void rehydrateTauriGlobals();
    setSettings(loadDictationSettings());
  }, []);

  const update = useCallback((next: DictationState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const cleanupAudio = useCallback(() => {
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      void audioContextRef.current.close();
    }
    processorRef.current = null;
    sourceRef.current = null;
    streamRef.current = null;
    audioContextRef.current = null;
  }, []);

  const finishAndPaste = useCallback(
    async (finalState: DictationState) => {
      cleanupAudio();
      wsRef.current?.close();
      wsRef.current = null;
      const text = settings.insertTrailingSpace
        ? `${fullTranscript(finalState)} `
        : fullTranscript(finalState);
      if (!text) return;
      if (!settings.autoPaste) {
        setCopied(false);
        return;
      }
      try {
        // Rust side writes the clipboard and hides this window.
        await invokeTauri("dictation_paste", { text });
        setCopied(true);
      } catch {
        // Outside Tauri (or IPC failed) — leave the transcript on screen
        // so the user can copy it manually.
        setCopied(false);
      }
    },
    [cleanupAudio, settings.autoPaste, settings.insertTrailingSpace]
  );

  const handleFrame = useCallback(
    (frame: TranscriptFrame) => {
      const next = applyTranscriptFrame(stateRef.current, frame);
      update(next);
      if (frame.type === "final" && frame.complete) {
        void finishAndPaste(next);
      }
    },
    [finishAndPaste, update]
  );

  const stop = useCallback(() => {
    // Stop feeding audio first so no frames race the {done} message.
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "done" }));
    } else {
      // Socket already gone — finalize from whatever we have.
      void finishAndPaste(stateRef.current);
    }
  }, [finishAndPaste]);

  const start = useCallback(async () => {
    setCopied(false);
    update({ ...INITIAL_DICTATION_STATE, status: "listening" });

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: settings.echoCancellation,
          noiseSuppression: settings.noiseSuppression,
        },
      });
    } catch {
      update({
        ...INITIAL_DICTATION_STATE,
        status: "error",
        error: "Microphone access was denied. Grant mic permission and try again.",
      });
      return;
    }
    streamRef.current = stream;

    const apiUrl = getApiUrl();
    const apiKey = getApiKey();
    const wsBase = apiUrl.replace(/^http/, "ws");
    const query = new URLSearchParams();
    if (settings.language.trim()) query.set("language", settings.language.trim());
    const suffix = query.toString() ? `?${query.toString()}` : "";
    // API key travels via WS subprotocol (out of the URL/logs), not the query.
    const ws = new WebSocket(`${wsBase}/api/transcribe/stream${suffix}`, wsAuthProtocols(apiKey));
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        handleFrame(JSON.parse(event.data as string) as TranscriptFrame);
      } catch {
        // Ignore frames we can't parse rather than killing the session.
      }
    };
    ws.onerror = () => {
      update({
        ...stateRef.current,
        status: "error",
        error: "Lost the connection to the Kural backend.",
      });
      cleanupAudio();
    };

    ws.onopen = () => {
      // AudioContext at 16 kHz so the samples match what the ASR expects;
      // ScriptProcessorNode is deprecated but avoids shipping a separate
      // AudioWorklet file, which the static export would otherwise need.
      const audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
      audioContextRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      sourceRef.current = source;
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;
      processor.onaudioprocess = (e) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        ws.send(floatTo16BitPCM(e.inputBuffer.getChannelData(0)));
      };
      source.connect(processor);
      processor.connect(audioContext.destination);
    };
  }, [cleanupAudio, handleFrame, settings, update]);

  useEffect(() => {
    return () => {
      cleanupAudio();
      wsRef.current?.close();
    };
  }, [cleanupAudio]);

  const listening = state.status === "listening";
  const transcript = fullTranscript(state);

  return (
    <main className="flex h-screen flex-col gap-2 bg-slate-950 p-3 text-slate-100">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Kural Dictation
        </span>
        <span
          className={`flex items-center gap-1 text-xs ${
            listening ? "text-emerald-400" : "text-slate-500"
          }`}
          aria-live="polite"
        >
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              listening ? "animate-pulse bg-emerald-400" : "bg-slate-600"
            }`}
          />
          {listening ? "Listening" : state.status === "done" ? "Done" : "Idle"}
        </span>
      </div>

      <div className="min-h-[44px] flex-1 overflow-y-auto rounded bg-slate-900 px-2 py-1 text-sm">
        {state.status === "error" ? (
          <p className="text-red-400" role="alert">
            {state.error}
          </p>
        ) : transcript ? (
          <p>
            <span>{state.finalizedText}</span>{" "}
            <span className="text-slate-400">{state.partialText}</span>
          </p>
        ) : (
          <p className="text-slate-500">
            {copied
              ? "Copied to clipboard."
              : "Press the mic and start speaking."}
          </p>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        {listening ? (
          <button
            type="button"
            onClick={settings.pushToTalk ? undefined : stop}
            onMouseUp={settings.pushToTalk ? stop : undefined}
            onTouchEnd={settings.pushToTalk ? stop : undefined}
            className="flex-1 rounded bg-red-500 px-3 py-1.5 text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-red-300"
          >
            {settings.autoPaste ? "Stop & Copy" : "Stop"}
          </button>
        ) : (
          <button
            type="button"
            onClick={settings.pushToTalk ? undefined : () => void start()}
            onMouseDown={settings.pushToTalk ? () => void start() : undefined}
            onTouchStart={settings.pushToTalk ? () => void start() : undefined}
            className="flex-1 rounded bg-emerald-500 px-3 py-1.5 text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-emerald-300"
          >
            {state.status === "error"
              ? "Retry"
              : settings.pushToTalk
                ? "Hold to Dictate"
                : "Start Dictation"}
          </button>
        )}
      </div>
    </main>
  );
}
