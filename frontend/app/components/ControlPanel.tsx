import type { AudioControls, OutputFormat } from "../lib/workspace";
import type { PerformanceStyle } from "../lib/performanceStyles";

export function ControlPanel(props: {
  controls: AudioControls;
  languageFilter: string;
  languages: string[];
  performanceStyleId: string;
  performanceStyles: PerformanceStyle[];
  selectedVoiceKey: string;
  voiceOptions: Array<{ key: string; label: string }>;
  onControlsChange: (controls: AudioControls) => void;
  onLanguageFilterChange: (language: string) => void;
  onPerformanceStyleChange: (styleId: string) => void;
  onVoiceChange: (voice: string) => void;
}) {
  const { controls, onControlsChange } = props;
  const activeStyle = props.performanceStyles.find(
    (style) => style.id === props.performanceStyleId
  );

  return (
    <section
      className="rounded border border-slate-300 p-3 focus-within:ring-2 focus-within:ring-slate-400"
      aria-labelledby="audio-controls-heading"
    >
      <h2 id="audio-controls-heading" className="mb-3 font-semibold">Advanced Audio</h2>
      <div className="space-y-3">
        <label className="block text-sm">
          Language filter
          <select
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-400"
            value={props.languageFilter}
            onChange={(event) => props.onLanguageFilterChange(event.target.value)}
          >
            {props.languages.map((language) => (
              <option key={language} value={language}>
                {language === "all" ? "All languages" : language}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          Performance style
          <select
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-400"
            value={props.performanceStyleId}
            onChange={(event) => props.onPerformanceStyleChange(event.target.value)}
          >
            {!activeStyle && <option value={props.performanceStyleId}>Custom</option>}
            {props.performanceStyles.map((style) => (
              <option key={style.id} value={style.id}>
                {style.label}
              </option>
            ))}
          </select>
          {activeStyle && (
            <span className="mt-1 block text-xs text-slate-500">
              {activeStyle.description}
            </span>
          )}
        </label>
        <label className="block text-sm">
          Voice
          <select
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-400"
            value={props.selectedVoiceKey}
            onChange={(event) => props.onVoiceChange(event.target.value)}
          >
            {props.voiceOptions.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span>
            Speed <span aria-hidden="true">{controls.speed.toFixed(2)}</span>
          </span>
          <input
            className="mt-1 w-full focus:outline-none focus:ring-2 focus:ring-slate-400"
            type="range"
            min={0.5}
            max={2}
            step={0.05}
            value={controls.speed}
            aria-valuetext={`${controls.speed.toFixed(2)} times`}
            onChange={(event) =>
              onControlsChange({ ...controls, speed: Number(event.target.value) })
            }
          />
        </label>
        <label className="block text-sm">
          <span>
            Pitch <span aria-hidden="true">{controls.pitchSemitones.toFixed(1)} st</span>
          </span>
          <input
            className="mt-1 w-full focus:outline-none focus:ring-2 focus:ring-slate-400"
            type="range"
            min={-6}
            max={6}
            step={0.5}
            value={controls.pitchSemitones}
            aria-valuetext={`${controls.pitchSemitones.toFixed(1)} semitones`}
            onChange={(event) =>
              onControlsChange({ ...controls, pitchSemitones: Number(event.target.value) })
            }
          />
        </label>
        <label className="block text-sm">
          <span>
            Volume <span aria-hidden="true">{controls.volumeDb.toFixed(1)} dB</span>
          </span>
          <input
            className="mt-1 w-full focus:outline-none focus:ring-2 focus:ring-slate-400"
            type="range"
            min={-12}
            max={6}
            step={0.5}
            value={controls.volumeDb}
            aria-valuetext={`${controls.volumeDb.toFixed(1)} decibels`}
            onChange={(event) =>
              onControlsChange({ ...controls, volumeDb: Number(event.target.value) })
            }
          />
        </label>
        <label className="block text-sm">
          <span>
            Pause scale <span aria-hidden="true">{controls.pauseScale.toFixed(2)}</span>
          </span>
          <input
            className="mt-1 w-full focus:outline-none focus:ring-2 focus:ring-slate-400"
            type="range"
            min={0.25}
            max={3}
            step={0.05}
            value={controls.pauseScale}
            aria-valuetext={`${controls.pauseScale.toFixed(2)} times`}
            onChange={(event) =>
              onControlsChange({ ...controls, pauseScale: Number(event.target.value) })
            }
          />
        </label>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={controls.normalize}
              onChange={(event) =>
                onControlsChange({ ...controls, normalize: event.target.checked })
              }
            />
            Normalize
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={controls.trimSilence}
              onChange={(event) =>
                onControlsChange({ ...controls, trimSilence: event.target.checked })
              }
            />
            Trim silence
          </label>
        </div>
        <label className="block text-sm">
          Format
          <select
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-400"
            value={controls.format}
            onChange={(event) =>
              onControlsChange({ ...controls, format: event.target.value as OutputFormat })
            }
          >
            <option value="wav">WAV</option>
            <option value="mp3">MP3</option>
          </select>
        </label>
      </div>
    </section>
  );
}
