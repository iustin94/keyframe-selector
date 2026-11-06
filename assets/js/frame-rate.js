const sampleTarget = 30;
const detectionTimeoutMilliseconds = 3000;
const snapTolerance = 0.01;
const minimumMeasurements = 3;
const standardRates = [24000 / 1001, 24, 25, 30000 / 1001, 30, 48000 / 1001, 48, 50, 60000 / 1001, 60, 100, 120000 / 1001, 120];

export class FrameRateUndetectableError extends Error {
  constructor(reason) {
    super(`Frame rate could not be detected: ${reason}. Enter it manually.`);
    this.name = "FrameRateUndetectableError";
  }
}

export async function detectFrameRate(video) {
  guardFrameCallbackSupport();
  const samples = await sampleFrames(video);
  const frameDuration = medianFrameDuration(samples);
  const measuredRate = 1 / frameDuration;
  return snapToStandardRate(measuredRate);
}

function guardFrameCallbackSupport() {
  const supported = "requestVideoFrameCallback" in HTMLVideoElement.prototype;
  if (!supported) throw new FrameRateUndetectableError("this browser does not expose video frame timing");
}

async function sampleFrames(video) {
  const originalTime = video.currentTime;
  const originalMuted = video.muted;
  video.muted = true;
  try {
    return await collectWhilePlaying(video);
  } finally {
    video.pause();
    video.muted = originalMuted;
    video.currentTime = originalTime;
  }
}

function collectWhilePlaying(video) {
  return new Promise((resolve, reject) => {
    const samples = [];
    let finished = false;
    const timeout = setTimeout(finish, detectionTimeoutMilliseconds);

    function finish() {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      video.removeEventListener("ended", finish);
      resolve(samples);
    }

    function recordFrame(now, metadata) {
      if (finished) return;
      samples.push({ mediaTime: metadata.mediaTime, presentedFrames: metadata.presentedFrames });
      if (samples.length >= sampleTarget) {
        finish();
        return;
      }
      video.requestVideoFrameCallback(recordFrame);
    }

    video.addEventListener("ended", finish);
    video.requestVideoFrameCallback(recordFrame);
    video.play().catch(reject);
  });
}

function medianFrameDuration(samples) {
  const durations = samples.slice(1).map((sample, index) => perFrameDuration(samples[index], sample));
  const valid = durations.filter((duration) => duration !== null).sort((shorter, longer) => shorter - longer);
  if (valid.length < minimumMeasurements) throw new FrameRateUndetectableError(`only ${valid.length} frame intervals were measured`);
  return valid[Math.floor(valid.length / 2)];
}

function perFrameDuration(earlier, later) {
  const mediaElapsed = later.mediaTime - earlier.mediaTime;
  const framesElapsed = later.presentedFrames - earlier.presentedFrames;
  const measurable = mediaElapsed > 0 && framesElapsed > 0;
  return measurable ? mediaElapsed / framesElapsed : null;
}

function snapToStandardRate(measuredRate) {
  let nearest = standardRates[0];
  for (const rate of standardRates) {
    if (Math.abs(rate - measuredRate) < Math.abs(nearest - measuredRate)) nearest = rate;
  }
  const relativeError = Math.abs(nearest - measuredRate) / nearest;
  return relativeError <= snapTolerance ? nearest : measuredRate;
}
