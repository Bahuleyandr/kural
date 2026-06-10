export interface DictationSettings {
  language: string;
  autoPaste: boolean;
  pushToTalk: boolean;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  insertTrailingSpace: boolean;
}

const STORAGE_KEY = "kural.dictation.settings.v1";

export const DEFAULT_DICTATION_SETTINGS: DictationSettings = {
  language: "",
  autoPaste: true,
  pushToTalk: false,
  echoCancellation: true,
  noiseSuppression: true,
  insertTrailingSpace: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function normalizeDictationSettings(value: unknown): DictationSettings {
  if (!isRecord(value)) return DEFAULT_DICTATION_SETTINGS;
  return {
    language: typeof value.language === "string" ? value.language : "",
    autoPaste: typeof value.autoPaste === "boolean" ? value.autoPaste : true,
    pushToTalk: typeof value.pushToTalk === "boolean" ? value.pushToTalk : false,
    echoCancellation:
      typeof value.echoCancellation === "boolean" ? value.echoCancellation : true,
    noiseSuppression:
      typeof value.noiseSuppression === "boolean" ? value.noiseSuppression : true,
    insertTrailingSpace:
      typeof value.insertTrailingSpace === "boolean" ? value.insertTrailingSpace : false,
  };
}

export function loadDictationSettings(): DictationSettings {
  if (typeof window === "undefined") return DEFAULT_DICTATION_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeDictationSettings(JSON.parse(raw)) : DEFAULT_DICTATION_SETTINGS;
  } catch {
    return DEFAULT_DICTATION_SETTINGS;
  }
}

export function saveDictationSettings(settings: DictationSettings): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
