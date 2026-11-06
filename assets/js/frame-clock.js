const endOfVideoMargin = 0.001;
const frameBoundaryTolerance = 1e-6;

export class InvalidFrameClockError extends Error {
  constructor(message) {
    super(message);
    this.name = "InvalidFrameClockError";
  }
}

export class FrameClock {
  constructor(framesPerSecond, duration) {
    FrameClock.#guardFramesPerSecond(framesPerSecond);
    FrameClock.#guardDuration(duration);
    this.framesPerSecond = framesPerSecond;
    this.duration = duration;
    this.frameCount = Math.max(1, Math.round(duration * framesPerSecond));
  }

  get lastFrame() {
    return this.frameCount - 1;
  }

  clampFrame(frame) {
    return Math.min(Math.max(frame, 0), this.lastFrame);
  }

  frameAt(time) {
    const frame = Math.floor(time * this.framesPerSecond + frameBoundaryTolerance);
    return this.clampFrame(frame);
  }

  timeOf(frame) {
    const midpoint = (this.clampFrame(frame) + 0.5) / this.framesPerSecond;
    const latestSeekableTime = Math.max(0, this.duration - endOfVideoMargin);
    return Math.min(midpoint, latestSeekableTime);
  }

  static #guardFramesPerSecond(framesPerSecond) {
    const positive = Number.isFinite(framesPerSecond) && framesPerSecond > 0;
    if (!positive) throw new InvalidFrameClockError(`Frame rate must be a positive number, got "${framesPerSecond}".`);
  }

  static #guardDuration(duration) {
    const known = Number.isFinite(duration) && duration > 0;
    if (!known) throw new InvalidFrameClockError("The video's duration is unknown, so its frames cannot be indexed. Re-encode it (browser-recorded WebM often lacks a duration).");
  }
}
