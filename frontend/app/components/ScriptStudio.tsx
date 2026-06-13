"use client";

import { useMemo, useRef, useState } from "react";

import type { Mode } from "../lib/types";
import type { ScriptVersion } from "../lib/workspace";

const SSML_CHIPS = [
  { label: "Pause 300ms", value: '<break time="300ms"/>' },
  { label: "Strong emphasis", value: "<emphasis level=\"strong\">important words</emphasis>" },
  { label: "Slow prosody", value: "<prosody rate=\"slow\">slow phrase</prosody>" },
  { label: "Spell out", value: '<say-as interpret-as="characters">Kural</say-as>' },
  { label: "Phoneme", value: '<phoneme alphabet="ipa" ph="kuːrəl">Kural</phoneme>' },
];

function analyzeScript(text: string) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const sentences = text.split(/[.!?]+/).map((part) => part.trim()).filter(Boolean);
  const longestSentence = sentences.reduce(
    (longest, sentence) => Math.max(longest, sentence.split(/\s+/).filter(Boolean).length),
    0
  );
  const estimatedSeconds = Math.round((words.length / 155) * 60);
  const issues: string[] = [];
  if (longestSentence > 32) issues.push("Split long sentences for more natural breath points.");
  if (words.length > 40 && !/[,.!?]/.test(text)) issues.push("Add punctuation before synthesis.");
  if (/\s{3,}/.test(text)) issues.push("Collapse extra spacing to avoid odd pauses.");
  if (/[A-Z]{8,}/.test(text)) issues.push("Avoid long all-caps words unless shouting is intended.");
  return {
    words: words.length,
    sentences: sentences.length,
    longestSentence,
    estimatedSeconds,
    issues,
  };
}

export function ScriptStudio(props: {
  text: string;
  mode: Mode;
  ssmlEnabled: boolean;
  versions: ScriptVersion[];
  onTextChange: (value: string) => void;
  onGenerateSelection: (value: string) => void;
  onRestoreVersion: (version: ScriptVersion) => void;
  onSaveVersion: () => void;
  onSsmlEnabledChange: (value: boolean) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const stats = useMemo(() => analyzeScript(props.text), [props.text]);

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

  function cleanupScript() {
    props.onTextChange(
      props.text
        .replace(/[ \t]+/g, " ")
        .replace(/\s+([,.!?;:])/g, "$1")
        .replace(/([,.!?;:])(?=\S)/g, "$1 ")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
    );
  }

  function splitParagraphs() {
    props.onTextChange(
      props.text
        .split(/(?<=[.!?])\s+/)
        .map((part) => part.trim())
        .filter(Boolean)
        .join("\n\n")
    );
  }

  function mergeLines() {
    props.onTextChange(
      props.text
        .split(/\n+/)
        .map((part) => part.trim())
        .filter(Boolean)
        .join(" ")
    );
  }

  function selectedTextOrLine(): string {
    const textarea = textareaRef.current;
    if (!textarea) return props.text.trim();
    const { selectionStart, selectionEnd } = textarea;
    if (selectionEnd > selectionStart) {
      return props.text.slice(selectionStart, selectionEnd).trim();
    }
    const before = props.text.lastIndexOf("\n", Math.max(0, selectionStart - 1));
    const after = props.text.indexOf("\n", selectionStart);
    return props.text.slice(before + 1, after >= 0 ? after : props.text.length).trim();
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

      <div className="mt-3 grid gap-2 text-sm md:grid-cols-4">
        <div className="rounded border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs uppercase text-slate-500">Words</p>
          <p className="font-semibold">{stats.words}</p>
        </div>
        <div className="rounded border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs uppercase text-slate-500">Sentences</p>
          <p className="font-semibold">{stats.sentences}</p>
        </div>
        <div className="rounded border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs uppercase text-slate-500">Longest</p>
          <p className="font-semibold">{stats.longestSentence} words</p>
        </div>
        <div className="rounded border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs uppercase text-slate-500">Read time</p>
          <p className="font-semibold">{stats.estimatedSeconds}s</p>
        </div>
      </div>
      {stats.issues.length > 0 && (
        <ul className="mt-3 grid gap-2 text-sm text-slate-700 md:grid-cols-2">
          {stats.issues.map((issue) => (
            <li key={issue} className="rounded border border-amber-200 bg-amber-50 px-3 py-2">
              {issue}
            </li>
          ))}
        </ul>
      )}

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

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          onClick={cleanupScript}
        >
          Clean Punctuation
        </button>
        <button
          type="button"
          className="rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          onClick={splitParagraphs}
        >
          Split Lines
        </button>
        <button
          type="button"
          className="rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          onClick={mergeLines}
        >
          Merge Lines
        </button>
        <button
          type="button"
          className="rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          onClick={() => insertSnippet(' <break time="250ms"/> ')}
        >
          Insert Pause
        </button>
        <button
          type="button"
          className="rounded border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          onClick={() => props.onGenerateSelection(selectedTextOrLine())}
        >
          Generate Selection
        </button>
      </div>

      <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium">Version history</h3>
          <button
            type="button"
            className="rounded border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-slate-400"
            onClick={props.onSaveVersion}
          >
            Save Version
          </button>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {props.versions.map((version) => (
            <button
              type="button"
              key={version.id}
              className="rounded border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-slate-400"
              onClick={() => props.onRestoreVersion(version)}
            >
              {version.label} / {version.createdAt.slice(11, 16)}
            </button>
          ))}
          {props.versions.length === 0 && (
            <span className="text-xs text-slate-500">No restore points saved for this project.</span>
          )}
        </div>
      </div>
    </section>
  );
}
