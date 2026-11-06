const thumbnailWidth = 240;
const thumbnailQuality = 0.8;
const seekTolerance = 0.001;

export class FrameCaptureError extends Error {
  constructor(message) {
    super(message);
    this.name = "FrameCaptureError";
  }
}

export function guardSeekable(video) {
  const ranges = video.seekable;
  const coversWholeVideo = ranges.length > 0 && ranges.end(ranges.length - 1) >= video.duration - seekTolerance;
  if (!coversWholeVideo) throw new FrameCaptureError("This video cannot be seeked. Its server must support HTTP Range requests; otherwise download the file and load it from disk.");
}

export function seekTo(video, time) {
  return new Promise((resolve, reject) => {
    function settle() {
      video.removeEventListener("seeked", settle);
      video.removeEventListener("error", fail);
      const landed = Math.abs(video.currentTime - time) <= seekTolerance;
      if (!landed) {
        reject(new FrameCaptureError(`Seeking to ${time.toFixed(3)} s landed at ${video.currentTime.toFixed(3)} s.`));
        return;
      }
      resolve();
    }

    function fail() {
      video.removeEventListener("seeked", settle);
      video.removeEventListener("error", fail);
      reject(new FrameCaptureError(`Seeking to ${time.toFixed(3)} s failed.`));
    }

    video.addEventListener("seeked", settle);
    video.addEventListener("error", fail);
    video.currentTime = time;
  });
}

export function captureFrame(video, mimeType, quality) {
  const canvas = drawToCanvas(video, video.videoWidth, video.videoHeight);
  return encodeCanvas(canvas, mimeType, quality);
}

export function captureThumbnail(video) {
  const scale = Math.min(1, thumbnailWidth / video.videoWidth);
  const width = Math.round(video.videoWidth * scale);
  const height = Math.round(video.videoHeight * scale);
  const canvas = drawToCanvas(video, width, height);
  return readDataUrl(canvas);
}

function drawToCanvas(video, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.drawImage(video, 0, 0, width, height);
  return canvas;
}

function readDataUrl(canvas) {
  try {
    return canvas.toDataURL("image/jpeg", thumbnailQuality);
  } catch (error) {
    throw describeTaintedCanvas(error);
  }
}

function encodeCanvas(canvas, mimeType, quality) {
  return new Promise((resolve, reject) => {
    function receive(blob) {
      if (blob === null) {
        reject(new FrameCaptureError("The browser returned no image data for this frame."));
        return;
      }
      if (blob.type !== mimeType) {
        reject(new FrameCaptureError(`This browser cannot encode ${mimeType}; choose another format.`));
        return;
      }
      resolve(blob);
    }

    try {
      canvas.toBlob(receive, mimeType, quality);
    } catch (error) {
      reject(describeTaintedCanvas(error));
    }
  });
}

function describeTaintedCanvas(error) {
  if (error.name !== "SecurityError") return error;
  return new FrameCaptureError("The video's server does not allow cross-origin access (CORS), so its frames cannot be read. Download the file and load it from disk instead.");
}
