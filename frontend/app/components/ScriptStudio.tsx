"use client";

import { useRef, useState } from "react";

import type { Mode } from "../lib/types";

interface ScriptVersion {
  id: string;
  label: string;
  text: string;
  createdAt: string;
}

const SSML_CHIPS = [
  { label: "Pause 300ms", value: '<break time="300ms"/>' },
  { label: "Strong emphasis", value: "<emphasis level=\"strong\">important words</emphasis>" },
  { label: "Slow prosody", value: "<prosody rate=\"slow\">slow phrase</prosody>" },
  { label: "Spell out", value: '<say-as interpret-as="characters">Kural</say-as>' },
  { label: "Phoneme", value: '<phoneme alphabet="ipa" ph="kuːrəl">Kural</phoneme>' },
];

export function ScriptStudio(props: {
  text: string;
  mode: Mode;
  ssmlEnabled: boolean;
  onTextChange: (value: string) => void;
  onSsmlEnabledChange: (value: boolean) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [versions, setVersions] = useState<ScriptVersion[]>([]);

  function insertSnippet(snippet: string) {
    const textarea = textareaRef.current;
    if (!textarea) {
      props.onTextChange(`${props.text}${props.text ? " " : ""}${snippet}`);
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const next = `${props.text.slice(0, start)}${snippet}${props.text.slice(end)}`;
    props.onTextChange(next);
    window.requestAnimationFrame(() => {
      textarea.focus();
      textarea.selectionStart = start;
      textarea.selectionEnd = start + snippet.length;
    });
  }

  function replaceNext() {
    if (!findText) return;
    const index = props.text.toLowerCase().indexOf(findText.toLowerCase());
    if (index < 0) return;
    props.onTextChange(
      `${props.text.slice(0, index)}${replaceText}${props.text.slice(index + findText.length)}`
    );
  }

  function replaceAll() {
    if (!findText) return;
    const escaped = findText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    props.onTextChange(props.text.replace(new RegExp(escaped, "gi"), replaceText));
  }

  function saveVersion() {
    setVersions((current) => [
      {
        id: `${Date.now()}`,
        label: `Version ${current.length + 1}`,
        text: props.text,
        createdAt: new Date().toISOString(),
      },
      ...current.slice(0, 9),
    ]);
  }

  return (
    <section className="rounded border border-slate-300 bg-white p-3" aria-labelledby="script-studio-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Script and SSML</p>
          <h2 id="script-studio-heading" className="font-semibold">Script Studio</h2>
        </div>
        <label className="flex items-center gap-2 rounded border border-slate-300 px-3 py-2 text-sm">
          <input
            type="checkbox"
            checked={props.ssmlEnabled}
            onChange={(event) => props.onSsmlEnabledChange(event.target.checked)}
          />
          SSML
        </label>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {SSML_CHIPS.map((chip) => (
          <button
            type="button"
            key={chip.label}
            className="rounded border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-slate-400"
            onClick={() => {
              props.onSsmlEnabledChange(true);
              insertSnippet(chip.value);
            }}
          >
            {chip.label}
          </button>
        ))}
      </div>

      <label className="mt-3 block text-sm font-medium">
        Text
        <textarea
          ref={textareaRef}
          id="script-text"
          className="mt-2 min-h-72 w-full resize-y rounded border border-slate-300 px-3 py-3 font-mono text-sm leading-6 focus:outline-none focus:ring-2 focus:ring-slate-400"
          value={props.text}
          onChange={(event) => props.onTextChange(event.target.value)}
          placeholder={
            props.mode === "batch"
              ? "Separate each script with a blank line."
              : "Write or paste the script for this project."
          }
        />
      </label>

      <div className="mt-3 grid gap-2 md:grid-cols-[1fr_1fr_auto_auto]">
        <input
          className="rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          value={findText}
          onChange={(event) => setFindText(event.target.value)}
          placeholder="Find"
          aria-label="Find"
        />
        <input
          className="rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          value={replaceText}
          onChange={(event) => setReplaceText(event.target.value)}
          placeholder="Replace"
          aria-label="Replace"
        />
        <button
          type="button"
          className="rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          onClick={replaceNext}
        >
          Replace
        </button>
        <button
          type="button"
          className="rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          onClick={replaceAll}
        >
          All
        </button>
      </div>

      <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium">Version history</h3>
          <button
            type="button"
            className="rounded border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-slate-400"
            onClick={saveVersion}
          >
            Save Version
          </button>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {versions.map((version) => (
            <button
              type="button"
              key={version.id}
              className="rounded border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-slate-400"
              onClick={() => props.onTextChange(version.text)}
            >
              {version.label} / {version.createdAt.slice(11, 16)}
            </button>
          ))}
          {versions.length === 0 && (
            <span className="text-xs text-slate-500">No saved versions in this session.</span>
          )}
        </div>
      </div>
    </section>
  );
}
