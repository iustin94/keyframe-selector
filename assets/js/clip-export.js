import {
  ALL_FORMATS,
  BufferTarget,
  Conversion,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  WebMOutputFormat,
} from "mediabunny";

export { ConversionCanceledError as ClipExportCanceledError } from "mediabunny";

export const clipContainers = {
  mp4: { createFormat: () => new Mp4OutputFormat(), videoCodecs: ["avc", "hevc", "vp9", "av1"], audioCodecs: ["aac", "opus"], extension: "mp4" },
  webm: { createFormat: () => new WebMOutputFormat(), videoCodecs: ["vp9", "vp8", "av1"], audioCodecs: ["opus", "vorbis"], extension: "webm" },
};

const discardReasons = {
  unknown_source_codec: "its codec is not recognised",
  undecodable_source_codec: "this browser cannot decode it",
  no_encodable_target_codec: "this browser cannot encode it in the chosen format",
  cannot_copy: "it cannot be copied",
  max_track_count_reached: "the output has too many tracks",
  max_track_count_of_type_reached: "the output has too many tracks of this type",
};

export class ClipExportError extends Error {
  constructor(message) {
    super(message);
    this.name = "ClipExportError";
  }
}

export class InvalidClipFrameRateError extends Error {
  constructor(frameRate) {
    super(`The output frame rate must be a positive number, got "${frameRate}".`);
    this.name = "InvalidClipFrameRateError";
  }
}

export class InvalidClipRangeError extends Error {
  constructor(start, end) {
    super(`The clip must end after it starts (start ${start.toFixed(3)} s, end ${end.toFixed(3)} s).`);
    this.name = "InvalidClipRangeError";
  }
}

export async function exportClip(mediaSource, request) {
  guardRange(request);
  guardFrameRate(request.frameRate);
  const input = new Input({ source: mediaSource, formats: ALL_FORMATS });
  try {
    const codecs = await chooseCodecs(input, request);
    const target = new BufferTarget();
    const format = request.container.createFormat();
    const output = new Output({ format, target });
    const conversionOptions = describeConversion(input, output, request, codecs);
    const conversion = await Conversion.init(conversionOptions);
    guardTracks(conversion, request);
    conversion.onProgress = request.onProgress;
    cancelOnAbort(conversion, request.signal);
    await conversion.execute();
    const mimeType = await output.getMimeType();
    const blob = new Blob([target.buffer], { type: mimeType });
    return { blob, codecs };
  } finally {
    input.dispose();
  }
}

async function chooseCodecs(input, request) {
  const video = await chooseVideoCodec(input, request.container);
  const audio = request.includeAudio ? await chooseAudioCodec(input, request.container) : null;
  return { video, audio };
}

async function chooseVideoCodec(input, container) {
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new ClipExportError("The input has no video track.");
  const dimensions = { width: track.displayWidth, height: track.displayHeight, quality: QUALITY_HIGH };
  const codec = await getFirstEncodableVideoCodec(container.videoCodecs, dimensions);
  if (!codec) throw new ClipExportError(`This browser cannot encode ${track.displayWidth}×${track.displayHeight} video as any of ${container.videoCodecs.join(", ")}. Try the other format.`);
  return codec;
}

async function chooseAudioCodec(input, container) {
  const track = await input.getPrimaryAudioTrack();
  if (!track) return null;
  const layout = { numberOfChannels: track.numberOfChannels, sampleRate: track.sampleRate, quality: QUALITY_HIGH };
  const codec = await getFirstEncodableAudioCodec(container.audioCodecs, layout);
  if (!codec) throw new ClipExportError(`This browser cannot encode audio as any of ${container.audioCodecs.join(", ")}. Untick "Include audio" or try the other format.`);
  return codec;
}

function cancelOnAbort(conversion, signal) {
  const cancel = () => conversion.cancel();
  if (signal.aborted) {
    cancel();
    return;
  }
  signal.addEventListener("abort", cancel, { once: true });
}

function guardRange(request) {
  if (request.end <= request.start) throw new InvalidClipRangeError(request.start, request.end);
}

function guardFrameRate(frameRate) {
  const keepsSourceTiming = frameRate === null;
  const positive = Number.isFinite(frameRate) && frameRate > 0;
  const acceptable = keepsSourceTiming || positive;
  if (!acceptable) throw new InvalidClipFrameRateError(frameRate);
}

function describeConversion(input, output, request, codecs) {
  const video = { codec: codecs.video, quality: QUALITY_HIGH };
  if (request.frameRate !== null) video.frameRate = request.frameRate;
  const audio = codecs.audio ? { codec: codecs.audio, quality: QUALITY_HIGH } : { discard: true };
  const trim = { start: request.start, end: request.end };
  return { input, output, video, audio, trim, copy: false, showWarnings: false };
}

function guardTracks(conversion, request) {
  const videoKept = conversion.utilizedTracks.some((track) => track.type === "video");
  if (!videoKept) throw new ClipExportError(`The video track was dropped: ${explainDiscard(conversion, "video")}.`);
  const audioDropped = conversion.discardedTracks.some((discarded) => isUnexpectedAudioDiscard(discarded, request));
  if (audioDropped) throw new ClipExportError(`The audio track was dropped: ${explainDiscard(conversion, "audio")}. Untick "Include audio" or try the other format.`);
  if (!conversion.isValid) throw new ClipExportError("The clip cannot be produced with these settings.");
}

function isUnexpectedAudioDiscard(discarded, request) {
  const isAudio = discarded.track.type === "audio";
  const userDiscarded = discarded.reason === "discarded_by_user";
  return request.includeAudio && isAudio && !userDiscarded;
}

function explainDiscard(conversion, trackType) {
  const discarded = conversion.discardedTracks.find((candidate) => candidate.track.type === trackType);
  if (!discarded) return "the input has no such track";
  return discardReasons[discarded.reason] ?? discarded.reason;
}
