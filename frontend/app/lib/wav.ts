function writeAscii(view: DataView, offset: number, value: string) {
  for (let i = 0; i < value.length; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}

function parsePcmWav(buffer: ArrayBuffer) {
  const view = new DataView(buffer);
  if (
    buffer.byteLength < 44 ||
    String.fromCharCode(...new Uint8Array(buffer.slice(0, 4))) !== "RIFF" ||
    String.fromCharCode(...new Uint8Array(buffer.slice(8, 12))) !== "WAVE"
  ) {
    throw new Error("Unsupported WAV data");
  }

  let offset = 12;
  let audioFormat = 0;
  let channels = 0;
  let sampleRate = 0;
  let byteRate = 0;
  let blockAlign = 0;
  let bitsPerSample = 0;
  let dataOffset = 0;
  let dataSize = 0;

  while (offset + 8 <= buffer.byteLength) {
    const chunkId = String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3)
    );
    const chunkSize = view.getUint32(offset + 4, true);
    const chunkDataOffset = offset + 8;

    if (chunkId === "fmt ") {
      audioFormat = view.getUint16(chunkDataOffset, true);
      channels = view.getUint16(chunkDataOffset + 2, true);
      sampleRate = view.getUint32(chunkDataOffset + 4, true);
      byteRate = view.getUint32(chunkDataOffset + 8, true);
      blockAlign = view.getUint16(chunkDataOffset + 12, true);
      bitsPerSample = view.getUint16(chunkDataOffset + 14, true);
    }

    if (chunkId === "data") {
      dataOffset = chunkDataOffset;
      dataSize = chunkSize;
      break;
    }

    offset = chunkDataOffset + chunkSize + (chunkSize % 2);
  }

  if (audioFormat !== 1 || !dataOffset) {
    throw new Error("Only PCM WAV chunks can be stitched");
  }

  // Clamp the declared data size to what the buffer actually holds — a crafted
  // WAV can claim a `data` chunk larger than the file, which would otherwise
  // throw a RangeError when constructing the view.
  const safeSize = Math.max(0, Math.min(dataSize, buffer.byteLength - dataOffset));

  return {
    audioFormat,
    channels,
    sampleRate,
    byteRate,
    blockAlign,
    bitsPerSample,
    data: new Uint8Array(buffer, dataOffset, safeSize),
  };
}

export async function stitchWavBlobs(blobs: Blob[]): Promise<Blob> {
  if (blobs.length === 0) {
    throw new Error("No WAV clips to stitch");
  }
  if (blobs.length === 1) return blobs[0];
  const wavs = await Promise.all(blobs.map(async (blob) => parsePcmWav(await blob.arrayBuffer())));
  const first = wavs[0];

  wavs.forEach((wav) => {
    if (
      wav.channels !== first.channels ||
      wav.sampleRate !== first.sampleRate ||
      wav.bitsPerSample !== first.bitsPerSample ||
      wav.blockAlign !== first.blockAlign
    ) {
      throw new Error("Generated WAV chunks used incompatible audio settings");
    }
  });

  const dataSize = wavs.reduce((total, wav) => total + wav.data.byteLength, 0);
  const output = new ArrayBuffer(44 + dataSize);
  const view = new DataView(output);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, first.audioFormat, true);
  view.setUint16(22, first.channels, true);
  view.setUint32(24, first.sampleRate, true);
  view.setUint32(28, first.byteRate, true);
  view.setUint16(32, first.blockAlign, true);
  view.setUint16(34, first.bitsPerSample, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);

  const bytes = new Uint8Array(output);
  let cursor = 44;
  wavs.forEach((wav) => {
    bytes.set(wav.data, cursor);
    cursor += wav.data.byteLength;
  });

  return new Blob([output], { type: "audio/wav" });
}
