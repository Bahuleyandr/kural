/**
 * Pure helpers for the dictation widget. The widget component itself is
 * imperative glue (getUserMedia / AudioContext / WebSocket / Tauri IPC)
 * that can only be exercised on a real desktop session — these functions
 * are the parts that can be unit-tested in isolation.
 */

/**
 * Convert mono Float32 PCM samples (the shape an AudioContext hands you)
 * into little-endian signed 16-bit PCM — the format the streaming ASR
 * WebSocket expects on its binary frames.
 */
export function floatTo16BitPCM(input: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(input.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < input.length; i += 1) {
    // Clamp before scaling — values can drift slightly outside [-1, 1].
    const sample = Math.max(-1, Math.min(1, input[i]));
    // Asymmetric int16 range: -32768..32767.
    view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return buffer;
}

export type DictationStatus = "idle" | "listening" | "done" | "error";

export interface DictationState {
  /** Utterances Vosk has committed (joined with spaces). */
  finalizedText: string;
  /** The in-progress hypothesis for the current utterance. */
  partialText: string;
  status: DictationStatus;
  error: string | null;
}

export type TranscriptFrame =
  | { type: "partial"; text: string }
  | { type: "final"; text: string; complete?: boolean }
  | { type: "error"; code?: string; message: string };

export const INITIAL_DICTATION_STATE: DictationState = {
  finalizedText: "",
  partialText: "",
  status: "idle",
  error: null,
};

/**
 * Fold one WebSocket frame into the widget state. Kept pure so the frame
 * handling — the part with real branching — is testable without a socket.
 *
 * - `partial` replaces the live hypothesis.
 * - `final` commits the utterance and clears the partial; `complete: true`
 *   (the server's reply to `{type: "done"}`) also flips status to "done".
 * - `error` surfaces the backend message (e.g. Vosk not configured) so the
 *   widget can tell the user to fall back to the batch transcribe flow.
 */
export function applyTranscriptFrame(
  state: DictationState,
  frame: TranscriptFrame
): DictationState {
  if (frame.type === "error") {
    return { ...state, status: "error", error: frame.message };
  }
  if (frame.type === "partial") {
    return { ...state, partialText: frame.text };
  }
  const finalizedText = [state.finalizedText, frame.text]
    .filter((part) => part.trim())
    .join(" ");
  return {
    ...state,
    finalizedText,
    partialText: "",
    status: frame.complete ? "done" : state.status,
  };
}

/** The full transcript so far — committed utterances plus the live partial. */
export function fullTranscript(state: DictationState): string {
  return [state.finalizedText, state.partialText]
    .filter((part) => part.trim())
    .join(" ")
    .trim();
}
