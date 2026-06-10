import { DEFAULT_CONTROLS, createId, type DubbingSegment } from "./workspace";

function parseTimecode(value: string): number {
  const match = value.trim().match(/^(\d{1,2}:)?(\d{1,2}):(\d{2})([,.](\d{1,3}))?$/);
  if (!match) return 0;
  const hours = match[1] ? Number(match[1].slice(0, -1)) : 0;
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const milliseconds = Number((match[5] || "0").padEnd(3, "0"));
  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + milliseconds;
}

function makeSegment(
  startMs: number,
  endMs: number,
  text: string,
  sourceLanguage: string,
  targetLanguage: string
): DubbingSegment {
  return {
    id: createId("dub"),
    startMs,
    endMs: Math.max(endMs, startMs + 1000),
    speaker: "Speaker 1",
    sourceText: text.trim(),
    targetText: text.trim(),
    sourceLanguage,
    targetLanguage,
    voiceId: "",
    controls: { ...DEFAULT_CONTROLS, format: "wav" },
    status: "draft",
    notes: "",
  };
}

function parseSubtitleBlocks(text: string, sourceLanguage: string, targetLanguage: string) {
  const blocks = text
    .replace(/\r/g, "")
    .replace(/^WEBVTT[\s\S]*?\n\n/, "")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  return blocks
    .map((block) => {
      const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
      const timingIndex = lines.findIndex((line) => line.includes("-->"));
      if (timingIndex < 0) return null;
      const [start, end] = lines[timingIndex].split("-->").map((part) => part.trim().split(/\s+/)[0]);
      const caption = lines.slice(timingIndex + 1).join(" ");
      if (!caption) return null;
      return makeSegment(parseTimecode(start), parseTimecode(end), caption, sourceLanguage, targetLanguage);
    })
    .filter((segment): segment is DubbingSegment => Boolean(segment));
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function parseCsv(text: string, sourceLanguage: string, targetLanguage: string) {
  const rows = text.replace(/\r/g, "").split("\n").map(splitCsvLine).filter((row) => row.length > 0);
  if (rows.length === 0) return [];
  const header = rows[0].map((cell) => cell.toLowerCase());
  const hasHeader = header.includes("text") || header.includes("source_text") || header.includes("start");
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const startIndex = hasHeader ? Math.max(header.indexOf("start_ms"), header.indexOf("start")) : 0;
  const endIndex = hasHeader ? Math.max(header.indexOf("end_ms"), header.indexOf("end")) : 1;
  const textIndex = hasHeader
    ? Math.max(header.indexOf("target_text"), header.indexOf("source_text"), header.indexOf("text"))
    : 2;

  return dataRows
    .map((row, index) => {
      const fallbackStart = index * 3000;
      const start = startIndex >= 0 ? row[startIndex] : "";
      const end = endIndex >= 0 ? row[endIndex] : "";
      const textCell = textIndex >= 0 ? row[textIndex] : row[row.length - 1];
      const startMs = /^\d+$/.test(start) ? Number(start) : parseTimecode(start) || fallbackStart;
      const endMs = /^\d+$/.test(end) ? Number(end) : parseTimecode(end) || startMs + 2500;
      return textCell ? makeSegment(startMs, endMs, textCell, sourceLanguage, targetLanguage) : null;
    })
    .filter((segment): segment is DubbingSegment => Boolean(segment));
}

function parsePlainText(text: string, sourceLanguage: string, targetLanguage: string) {
  return text
    .split(/\n\s*\n/g)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part, index) =>
      makeSegment(index * 3000, index * 3000 + Math.max(1500, part.length * 60), part, sourceLanguage, targetLanguage)
    );
}

export function parseTranscript(
  filename: string,
  text: string,
  sourceLanguage: string,
  targetLanguage: string
): DubbingSegment[] {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".srt") || lower.endsWith(".vtt")) {
    return parseSubtitleBlocks(text, sourceLanguage, targetLanguage);
  }
  if (lower.endsWith(".csv")) {
    return parseCsv(text, sourceLanguage, targetLanguage);
  }
  return parsePlainText(text, sourceLanguage, targetLanguage);
}

export function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const millis = ms % 1000;
  return `${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}.${millis.toString().padStart(3, "0")}`;
}

function srtTime(ms: number): string {
  return formatTime(ms).replace(".", ",");
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export function exportSegmentsAsSrt(segments: DubbingSegment[]): string {
  return segments
    .map((segment, index) =>
      [
        String(index + 1),
        `${srtTime(segment.startMs)} --> ${srtTime(segment.endMs)}`,
        segment.targetText || segment.sourceText,
      ].join("\n")
    )
    .join("\n\n");
}

export function exportSegmentsAsVtt(segments: DubbingSegment[]): string {
  return `WEBVTT\n\n${segments
    .map((segment) =>
      [
        `${formatTime(segment.startMs)} --> ${formatTime(segment.endMs)}`,
        segment.targetText || segment.sourceText,
      ].join("\n")
    )
    .join("\n\n")}\n`;
}

export function exportSegmentsAsCsv(segments: DubbingSegment[]): string {
  const rows = [
    "start_ms,end_ms,speaker,source_text,target_text,voice_id,status,notes",
    ...segments.map((segment) =>
      [
        segment.startMs,
        segment.endMs,
        csvCell(segment.speaker || "Speaker 1"),
        csvCell(segment.sourceText),
        csvCell(segment.targetText),
        csvCell(segment.voiceId),
        csvCell(segment.status),
        csvCell(segment.notes),
      ].join(",")
    ),
  ];
  return rows.join("\n");
}
