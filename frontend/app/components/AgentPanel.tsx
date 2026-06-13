import { useEffect, useRef, useState } from "react";

import { apiFetch, getApiKey, readApiError } from "../lib/api";
import {
  applyTranscriptFrame,
  floatTo16BitPCM,
  fullTranscript,
  INITIAL_DICTATION_STATE,
  type DictationState,
  type TranscriptFrame,
} from "../lib/dictation";

interface AgentTurnResponse {
  text: string;
  intent: string;
  tool_plan: string[];
  interruptible: boolean;
  local_only: boolean;
  llm_provider: string;
  llm_model?: string | null;
}

const SAMPLE_RATE = 16000;

export function AgentPanel(props: {
  apiUrl: string;
  projectLanguage: string;
  selectedVoiceLabel: string;
  onSpeakResponse: (text: string) => Promise<Blob>;
}) {
  const [message, setMessage] = useState("");
  const [response, setResponse] = useState<AgentTurnResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [useLlm, setUseLlm] = useState(false);
  const [llmModel, setLlmModel] = useState("llama3.1:8b");
  const [transcriptState, setTranscriptState] =
    useState<DictationState>(INITIAL_DICTATION_STATE);
  const [error, setError] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef("");
  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const transcriptStateRef = useRef<DictationState>(INITIAL_DICTATION_STATE);

  function interrupt() {
    audioRef.current?.pause();
    audioRef.current = null;
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = "";
    }
    setSpeaking(false);
  }

  function cleanupMic() {
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
    setListening(false);
  }

  async function speakText(text: string) {
    interrupt();
    setSpeaking(true);
    setError("");
    try {
      const blob = await props.onSpeakResponse(text);
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      urlRef.current = url;
      audio.addEventListener(
        "ended",
        () => {
          interrupt();
        },
        { once: true }
      );
      await audio.play();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Could not speak response.");
      interrupt();
    }
  }

  async function askAgent(input = message.trim()) {
    const clean = input.trim();
    if (!clean) return;
    interrupt();
    setBusy(true);
    setError("");
    try {
      const res = await apiFetch(`${props.apiUrl}/api/agent/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: clean,
          project_language: props.projectLanguage,
          tool_context: ["tts", "dubbing", "models", "clone-studio"],
          use_llm: useLlm,
          llm_provider: useLlm ? "ollama" : "deterministic",
          llm_model: useLlm ? llmModel : undefined,
        }),
      });
      if (!res.ok) throw new Error(await readApiError(res));
      const payload = (await res.json()) as AgentTurnResponse;
      setResponse(payload);
      if (autoSpeak) {
        await speakText(payload.text);
      }
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Could not ask local agent.");
    } finally {
      setBusy(false);
    }
  }

  async function speakResponse() {
    if (!response?.text) return;
    await speakText(response.text);
  }

  function applyFrame(frame: TranscriptFrame) {
    const next = applyTranscriptFrame(transcriptStateRef.current, frame);
    transcriptStateRef.current = next;
    setTranscriptState(next);
    const transcript = fullTranscript(next);
    if (transcript) setMessage(transcript);
    if (frame.type === "final" && frame.complete && transcript) {
      void askAgent(transcript);
    }
  }

  async function startMicAgent() {
    interrupt();
    setError("");
    transcriptStateRef.current = { ...INITIAL_DICTATION_STATE, status: "listening" };
    setTranscriptState(transcriptStateRef.current);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
    } catch {
      setError("Microphone access was denied.");
      return;
    }
    streamRef.current = stream;
    const wsBase = props.apiUrl.replace(/^http/, "ws");
    const query = new URLSearchParams();
    const apiKey = getApiKey();
    if (apiKey) query.set("api_key", apiKey);
    if (props.projectLanguage) query.set("language", props.projectLanguage);
    const ws = new WebSocket(`${wsBase}/api/transcribe/stream?${query.toString()}`);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;
    ws.onmessage = (event) => {
      try {
        applyFrame(JSON.parse(event.data as string) as TranscriptFrame);
      } catch {
        // Ignore malformed local ASR frames.
      }
    };
    ws.onerror = () => {
      setError("Local STT stream is unavailable. Install or configure Vosk.");
      cleanupMic();
    };
    ws.onclose = () => cleanupMic();
    ws.onopen = () => {
      setListening(true);
      const audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
      audioContextRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      sourceRef.current = source;
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;
      processor.onaudioprocess = (event) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(floatTo16BitPCM(event.inputBuffer.getChannelData(0)));
        }
      };
      source.connect(processor);
      processor.connect(audioContext.destination);
    };
  }

  function stopMicAgent() {
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "done" }));
    } else {
      cleanupMic();
    }
  }

  useEffect(() => {
    return () => {
      cleanupMic();
      wsRef.current?.close();
      interrupt();
    };
  }, []);

  return (
    <section className="space-y-4" aria-labelledby="agent-panel-heading">
      <div className="rounded border border-slate-300 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Local assistant</p>
            <h2 id="agent-panel-heading" className="text-lg font-semibold">
              Kural Agents
            </h2>
          </div>
          <span className="rounded border border-slate-200 px-3 py-1 text-sm">
            {props.selectedVoiceLabel}
          </span>
        </div>
        <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_240px]">
          <label className="text-sm font-medium">
            Prompt
            <textarea
              className="mt-2 min-h-32 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Ask Kural to help with a local voice, dubbing, model, or script task."
            />
          </label>
          <div className="flex flex-col gap-2 self-end">
            <button
              type="button"
              className="rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:opacity-50"
              disabled={busy}
              onClick={listening ? stopMicAgent : () => void startMicAgent()}
            >
              {listening ? "Stop & Ask" : "Mic Agent"}
            </button>
            <button
              type="button"
              className="rounded bg-slate-950 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:opacity-50"
              disabled={busy || !message.trim()}
              onClick={() => void askAgent()}
              aria-busy={busy}
            >
              {busy ? "Thinking..." : "Ask Local Agent"}
            </button>
            <button
              type="button"
              className="rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:opacity-50"
              disabled={!response?.text || speaking}
              onClick={() => void speakResponse()}
            >
              Speak Response
            </button>
            <button
              type="button"
              className="rounded border border-amber-300 px-3 py-2 text-sm text-amber-800 focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:opacity-50"
              disabled={!speaking}
              onClick={interrupt}
            >
              Interrupt
            </button>
          </div>
        </div>
        <div className="mt-3 grid gap-2 text-sm md:grid-cols-[auto_auto_1fr]">
          <label className="flex items-center gap-2 rounded border border-slate-300 px-3 py-2">
            <input
              type="checkbox"
              checked={autoSpeak}
              onChange={(event) => setAutoSpeak(event.target.checked)}
            />
            Auto speak
          </label>
          <label className="flex items-center gap-2 rounded border border-slate-300 px-3 py-2">
            <input
              type="checkbox"
              checked={useLlm}
              onChange={(event) => setUseLlm(event.target.checked)}
            />
            Ollama
          </label>
          <input
            className="rounded border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-400"
            value={llmModel}
            onChange={(event) => setLlmModel(event.target.value)}
            aria-label="Ollama model"
          />
        </div>
        {(listening || fullTranscript(transcriptState)) && (
          <p className="mt-3 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            {listening ? "Listening: " : "Heard: "}
            {fullTranscript(transcriptState) || "..."}
          </p>
        )}
        {error && (
          <p className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            {error}
          </p>
        )}
      </div>

      {response && (
        <section className="rounded border border-slate-300 bg-white p-4" aria-label="Agent response">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold capitalize">{response.intent}</h3>
            <span className="rounded border border-slate-200 px-2 py-1 text-xs">
              {response.llm_provider === "ollama" ? response.llm_model || "ollama" : "deterministic"}
            </span>
          </div>
          <p className="mt-3 text-sm text-slate-800">{response.text}</p>
          <div className="mt-3 flex flex-wrap gap-1">
            {response.tool_plan.map((step) => (
              <span key={step} className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-600">
                {step.replace(/_/g, " ")}
              </span>
            ))}
          </div>
        </section>
      )}
    </section>
  );
}
