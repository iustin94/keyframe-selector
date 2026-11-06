const slotBoundaryTolerance = 1e-6;

export class ClipPreviewUnsupportedError extends Error {
  constructor() {
    super("This browser does not expose video frame timing, so the clip cannot be previewed at its output frame rate.");
    this.name = "ClipPreviewUnsupportedError";
  }
}

export class ClipPreview {
  #video;
  #canvas;
  #describeClip;
  #onStateChange;
  #running = false;
  #awaitingSeek = false;
  #lastSlot = null;
  #frameRequest = null;

  constructor(video, canvas, describeClip, onStateChange) {
    this.#video = video;
    this.#canvas = canvas;
    this.#describeClip = describeClip;
    this.#onStateChange = onStateChange;
    video.addEventListener("timeupdate", this.#enforceBounds);
    video.addEventListener("ended", this.#enforceBounds);
  }

  get running() {
    return this.#running;
  }

  start() {
    guardFrameCallbackSupport();
    this.#running = true;
    this.#restartLoop();
    this.#video.play().catch((error) => this.#fail(error));
    this.#onStateChange();
  }

  stop() {
    if (!this.#running) return;
    this.#running = false;
    this.#video.cancelVideoFrameCallback(this.#frameRequest);
    this.#video.pause();
    this.#canvas.hidden = true;
    this.#onStateChange();
  }

  #fail(error) {
    this.stop();
    throw error;
  }

  #restartLoop() {
    const clip = this.#describeClip();
    this.#lastSlot = null;
    this.#awaitingSeek = true;
    this.#video.addEventListener("seeked", this.#seekLanded, { once: true });
    this.#video.currentTime = clip.firstFrameTime;
    this.#awaitNextFrame();
  }

  #awaitNextFrame() {
    this.#frameRequest = this.#video.requestVideoFrameCallback(this.#presentFrame);
  }

  #enforceBounds = () => {
    const leftClip = this.#running && !this.#awaitingSeek && this.#isOutsideClip(this.#video.currentTime);
    if (!leftClip) return;
    this.#video.cancelVideoFrameCallback(this.#frameRequest);
    this.#restartLoop();
    this.#video.play().catch((error) => this.#fail(error));
  };

  #isOutsideClip(mediaTime) {
    const clip = this.#describeClip();
    return mediaTime >= clip.end || mediaTime < clip.start;
  }

  #seekLanded = () => {
    this.#awaitingSeek = false;
  };

  #presentFrame = (now, metadata) => {
    if (!this.#running) return;
    if (this.#awaitingSeek) {
      this.#awaitNextFrame();
      return;
    }
    if (this.#isOutsideClip(metadata.mediaTime)) {
      this.#restartLoop();
      return;
    }
    const clip = this.#describeClip();
    this.#paintOutputFrame(metadata.mediaTime, clip);
    this.#awaitNextFrame();
  };

  #paintOutputFrame(mediaTime, clip) {
    const keepsSourceTiming = clip.frameRate === null;
    this.#canvas.hidden = keepsSourceTiming;
    if (keepsSourceTiming) return;
    const slot = Math.floor((mediaTime - clip.start) * clip.frameRate + slotBoundaryTolerance);
    const startsNewSlot = this.#lastSlot === null || slot > this.#lastSlot;
    if (!startsNewSlot) return;
    this.#lastSlot = slot;
    this.#drawCurrentFrame();
  }

  #drawCurrentFrame() {
    const width = this.#video.videoWidth;
    const height = this.#video.videoHeight;
    const sizeChanged = this.#canvas.width !== width || this.#canvas.height !== height;
    if (sizeChanged) {
      this.#canvas.width = width;
      this.#canvas.height = height;
    }
    const context = this.#canvas.getContext("2d");
    context.drawImage(this.#video, 0, 0, width, height);
  }
}

function guardFrameCallbackSupport() {
  const supported = "requestVideoFrameCallback" in HTMLVideoElement.prototype;
  if (!supported) throw new ClipPreviewUnsupportedError();
}
