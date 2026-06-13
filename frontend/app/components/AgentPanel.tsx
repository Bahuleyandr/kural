import { useRef, useState } from "react";

import { apiFetch, readApiError } from "../lib/api";

interface AgentTurnResponse {
  text: string;
  intent: string;
  tool_plan: string[];
  interruptible: boolean;
  local_only: boolean;
}

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
  const [error, setError] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef("");

  function interrupt() {
    audioRef.current?.pause();
    audioRef.current = null;
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = "";
    }
    setSpeaking(false);
  }

  async function askAgent() {
    if (!message.trim()) return;
    interrupt();
    setBusy(true);
    setError("");
    try {
      const res = await apiFetch(`${props.apiUrl}/api/agent/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: message.trim(),
          project_language: props.projectLanguage,
          tool_context: ["tts", "dubbing", "models", "clone-studio"],
        }),
      });
      if (!res.ok) throw new Error(await readApiError(res));
      setResponse((await res.json()) as AgentTurnResponse);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Could not ask local agent.");
    } finally {
      setBusy(false);
    }
  }

  async function speakResponse() {
    if (!response?.text) return;
    interrupt();
    setSpeaking(true);
    setError("");
    try {
      const blob = await props.onSpeakResponse(response.text);
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
        <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
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
              {response.local_only ? "local only" : "external"}
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
