"use client";

import { useEffect, useState } from "react";

import { apiFetch, readApiError } from "../lib/api";
import type { ClonedVoiceInfo, LocalModelInfo, VoiceInfo } from "../lib/types";

export interface BackendStatus {
  voices: VoiceInfo[];
  clones: ClonedVoiceInfo[];
  localModels: LocalModelInfo[];
  backendStatus: string | null;
  backendError: string;
  voicesError: string | null;
  localModelError: string | null;
  refreshClones: () => Promise<void>;
}

/**
 * Centralises the read-side fetches that the workspace page used to do
 * inline: backend health, voice list, cloned voices, local model status.
 * Aborts in flight on apiUrl change; the caller decides cadence.
 */
export function useBackendStatus(apiUrl: string): BackendStatus {
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [clones, setClones] = useState<ClonedVoiceInfo[]>([]);
  const [localModels, setLocalModels] = useState<LocalModelInfo[]>([]);
  const [backendStatus, setBackendStatus] = useState<string | null>(null);
  const [backendError, setBackendError] = useState("");
  const [voicesError, setVoicesError] = useState<string | null>(null);
  const [localModelError, setLocalModelError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  async function refreshClones(): Promise<void> {
    const res = await apiFetch(`${apiUrl}/api/voices/clones`);
    if (!res.ok) throw new Error(await readApiError(res));
    const data = await res.json();
    setClones(data.clones ?? []);
  }

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const isAbortError = (exc: unknown) =>
      exc instanceof DOMException && exc.name === "AbortError";

    async function load() {
      try {
        const health = await apiFetch(`${apiUrl}/api/health`, { signal });
        if (health.ok) {
          const data = await health.json();
          if (!signal.aborted) setBackendStatus(`${data.engine} ${data.version}`);
        }
      } catch (exc) {
        if (!signal.aborted && !isAbortError(exc)) {
          setBackendError("Backend is not reachable yet.");
        }
      }

      try {
        const res = await apiFetch(`${apiUrl}/api/voices`, { signal });
        if (!res.ok) throw new Error(await readApiError(res));
        const data = await res.json();
        if (!signal.aborted) {
          setVoices(data.voices ?? []);
          setVoicesError(null);
        }
      } catch (exc) {
        if (!signal.aborted && !isAbortError(exc)) {
          setVoicesError(exc instanceof Error ? exc.message : "Could not load voices");
        }
      }

      try {
        const res = await apiFetch(`${apiUrl}/api/voices/clones`, { signal });
        if (res.ok) {
          const data = await res.json();
          if (!signal.aborted) setClones(data.clones ?? []);
        }
      } catch (exc) {
        if (!signal.aborted && !isAbortError(exc)) setClones([]);
      }

      try {
        const res = await apiFetch(`${apiUrl}/api/local-models`, { signal });
        if (!res.ok) throw new Error(await readApiError(res));
        const data = await res.json();
        if (!signal.aborted) {
          setLocalModels(data.models ?? []);
          setLocalModelError(null);
        }
      } catch (exc) {
        if (!signal.aborted && !isAbortError(exc)) {
          setLocalModels([]);
          setLocalModelError(
            exc instanceof Error ? exc.message : "Could not load local model status"
          );
        }
      }
    }

    void load();
    return () => {
      controller.abort();
    };
  }, [apiUrl, reloadTick]);

  return {
    voices,
    clones,
    localModels,
    backendStatus,
    backendError,
    voicesError,
    localModelError,
    refreshClones: async () => {
      await refreshClones();
      setReloadTick((tick) => tick + 1);
    },
  };
}
