import { detectFrameRate } from "./frame-rate.js";
import { FrameClock } from "./frame-clock.js";
import { FrameSelection } from "./frame-selection.js";
import { VideoSource } from "./video-source.js";
import { guardSeekable, seekTo, captureFrame, captureThumbnail } from "./video-frames.js";
import { buildZip } from "./zip-archive.js";
import { downloadBlob } from "./download.js";

const largeRangeThreshold = 500;
const individualDownloadPauseMilliseconds = 300;

const imageFormats = {
  png: { mimeType: "image/png", extension: "png", lossy: false },
  jpeg: { mimeType: "image/jpeg", extension: "jpg", lossy: true },
  webp: { mimeType: "image/webp", extension: "webp", lossy: true },
};

class VideoLoadError extends Error {
  constructor(message) {
    super(message);
    this.name = "VideoLoadError";
  }
}

const byId = (id) => document.getElementById(id);

const ui = {
  sourcePicker: byId("source-picker"),
  dropZone: byId("drop-zone"),
  fileInput: byId("video-file"),
  urlForm: byId("video-url-form"),
  urlInput: byId("video-url"),
  player: byId("player"),
  videoName: byId("video-name"),
  changeVideo: byId("change-video"),
  video: byId("video"),
  scrubber: byId("scrubber"),
  backTen: byId("back-ten"),
  backOne: byId("back-one"),
  playPause: byId("play-pause"),
  forwardOne: byId("forward-one"),
  forwardTen: byId("forward-ten"),
  readout: byId("frame-readout"),
  framesPerSecond: byId("frames-per-second"),
  frameRateSource: byId("frame-rate-source"),
  toggleFrame: byId("toggle-frame"),
  rangeFrom: byId("range-from"),
  rangeTo: byId("range-to"),
  rangeEvery: byId("range-every"),
  addRange: byId("add-range"),
  selectionPanel: byId("selection-panel"),
  selectionCount: byId("selection-count"),
  selectionList: byId("selection-list"),
  clearSelection: byId("clear-selection"),
  imageFormat: byId("image-format"),
  imageQuality: byId("image-quality"),
  imageQualityReadout: byId("image-quality-readout"),
  filePrefix: byId("file-prefix"),
  downloadZip: byId("download-zip"),
  downloadFiles: byId("download-files"),
  status: byId("status"),
  statusMessage: byId("status-message"),
  statusProgress: byId("status-progress"),
};

const selection = new FrameSelection(renderSelection);
let clock = null;
let source = null;
let busy = false;

wireSourcePicker();
wirePlayer();
wireSelection();
wireKeyboard();
window.addEventListener("unhandledrejection", (event) => reportError(event.reason));
ui.status.addEventListener("click", clearStatus);

function wireSourcePicker() {
  ui.fileInput.addEventListener("change", () => {
    const file = ui.fileInput.files[0];
    ui.fileInput.value = "";
    if (file) openFile(file);
  });

  ui.urlForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const link = ui.urlInput.value.trim();
    runExclusive(() => openLink(link));
  });

  document.addEventListener("dragover", (event) => {
    event.preventDefault();
    ui.dropZone.classList.add("dragging");
  });

  document.addEventListener("dragleave", () => ui.dropZone.classList.remove("dragging"));

  document.addEventListener("drop", (event) => {
    event.preventDefault();
    ui.dropZone.classList.remove("dragging");
    const file = event.dataTransfer.files[0];
    if (file) openFile(file);
  });

  ui.changeVideo.addEventListener("click", showSourcePicker);
}

function wirePlayer() {
  ui.scrubber.addEventListener("input", () => showFrame(Number(ui.scrubber.value)));
  ui.backTen.addEventListener("click", () => stepFrames(-10));
  ui.backOne.addEventListener("click", () => stepFrames(-1));
  ui.forwardOne.addEventListener("click", () => stepFrames(1));
  ui.forwardTen.addEventListener("click", () => stepFrames(10));
  ui.playPause.addEventListener("click", togglePlayback);
  ui.toggleFrame.addEventListener("click", () => runExclusive(toggleCurrentFrame));
  ui.addRange.addEventListener("click", () => runExclusive(addFrameRange));
  ui.framesPerSecond.addEventListener("change", applyManualFrameRate);
  ui.video.addEventListener("seeked", renderReadout);
  ui.video.addEventListener("timeupdate", renderReadout);
  ui.video.addEventListener("play", renderPlayState);
  ui.video.addEventListener("pause", renderPlayState);
  ui.video.addEventListener("click", togglePlayback);
}

function wireSelection() {
  ui.clearSelection.addEventListener("click", () => selection.clear());
  ui.imageFormat.addEventListener("change", renderQualityControl);

  ui.imageQuality.addEventListener("input", () => {
    const percent = Math.round(Number(ui.imageQuality.value) * 100);
    ui.imageQualityReadout.value = `${percent}%`;
  });

  ui.downloadZip.addEventListener("click", () => runExclusive(downloadAsZip));
  ui.downloadFiles.addEventListener("click", () => runExclusive(downloadAsFiles));
}

function wireKeyboard() {
  document.addEventListener("keydown", (event) => {
    const playerHidden = ui.player.hidden;
    const typingInField = isTextEntry(event.target);
    if (playerHidden || typingInField || busy) return;
    const stride = event.shiftKey ? 10 : 1;

    switch (event.key) {
      case "ArrowLeft":
        event.preventDefault();
        stepFrames(-stride);
        break;
      case "ArrowRight":
        event.preventDefault();
        stepFrames(stride);
        break;
      case " ":
        event.preventDefault();
        togglePlayback();
        break;
      case "s":
      case "S":
        event.preventDefault();
        runExclusive(toggleCurrentFrame);
        break;
    }
  });
}

function isTextEntry(target) {
  const textTypes = ["text", "url", "number"];
  const isTextInput = target instanceof HTMLInputElement && textTypes.includes(target.type);
  const isSelect = target instanceof HTMLSelectElement;
  return isTextInput || isSelect;
}

function openFile(file) {
  runExclusive(() => {
    const fileSource = VideoSource.fromFile(file);
    return openSource(fileSource);
  });
}

function openLink(link) {
  const linkSource = VideoSource.fromLink(link);
  return openSource(linkSource);
}

async function openSource(nextSource) {
  showSourcePicker();
  source?.release();
  source = nextSource;
  clock = null;
  selection.clear();
  ui.videoName.textContent = source.name;
  ui.filePrefix.value = source.stem;
  reportProgress(`Loading ${source.name}…`);
  await loadIntoVideo(source);
  guardSeekable(ui.video);
  clearStatus();
  await establishFrameRate();
  ui.sourcePicker.hidden = true;
  ui.player.hidden = false;
  showFrame(0);
}

function loadIntoVideo(videoSource) {
  return new Promise((resolve, reject) => {
    function loaded() {
      detach();
      resolve();
    }

    function failed() {
      detach();
      reject(describeLoadFailure(videoSource));
    }

    function detach() {
      ui.video.removeEventListener("loadeddata", loaded);
      ui.video.removeEventListener("error", failed);
    }

    ui.video.addEventListener("loadeddata", loaded);
    ui.video.addEventListener("error", failed);
    ui.video.crossOrigin = videoSource.crossOrigin;
    ui.video.src = videoSource.url;
    ui.video.load();
  });
}

function describeLoadFailure(videoSource) {
  const remote = videoSource.crossOrigin !== null;
  if (remote) return new VideoLoadError(`Could not load ${videoSource.url}. Either it is not a video this browser can play, or its server does not allow cross-origin access (CORS).`);
  return new VideoLoadError(`This browser cannot play ${videoSource.name}; its container or codec is unsupported.`);
}

async function establishFrameRate() {
  try {
    const detected = await detectFrameRate(ui.video);
    applyFrameRate(detected, "detected");
  } catch (error) {
    const fallback = Number(ui.framesPerSecond.value);
    applyFrameRate(fallback, "not detected — check it");
    reportError(error);
  }
}

function applyManualFrameRate() {
  try {
    const entered = Number(ui.framesPerSecond.value);
    applyFrameRate(entered, "manual");
    showFrame(currentFrame());
  } catch (error) {
    ui.framesPerSecond.value = formatRate(clock.framesPerSecond);
    reportError(error);
  }
}

function applyFrameRate(framesPerSecond, origin) {
  clock = new FrameClock(framesPerSecond, ui.video.duration);
  ui.framesPerSecond.value = formatRate(framesPerSecond);
  ui.frameRateSource.textContent = origin;
  ui.scrubber.max = String(clock.lastFrame);
  ui.rangeFrom.max = String(clock.lastFrame);
  ui.rangeTo.max = String(clock.lastFrame);
  ui.rangeTo.value = String(clock.lastFrame);
  renderSelection();
  renderReadout();
}

function showSourcePicker() {
  ui.video.pause();
  ui.player.hidden = true;
  ui.selectionPanel.hidden = true;
  ui.sourcePicker.hidden = false;
}

function currentFrame() {
  return clock.frameAt(ui.video.currentTime);
}

function showFrame(frame) {
  ui.video.currentTime = clock.timeOf(frame);
}

function stepFrames(delta) {
  ui.video.pause();
  const target = clock.clampFrame(currentFrame() + delta);
  showFrame(target);
}

function togglePlayback() {
  if (ui.video.paused) {
    ui.video.play().catch(reportError);
    trackPlayback();
    return;
  }
  ui.video.pause();
}

function trackPlayback() {
  const supportsFrameCallback = "requestVideoFrameCallback" in HTMLVideoElement.prototype;
  if (!supportsFrameCallback) return;

  function onFrame() {
    renderReadout();
    if (!ui.video.paused) ui.video.requestVideoFrameCallback(onFrame);
  }

  ui.video.requestVideoFrameCallback(onFrame);
}

async function toggleCurrentFrame() {
  ui.video.pause();
  const frame = currentFrame();
  const existing = selection.find(clock, frame);
  if (existing) {
    selection.remove(existing);
    return;
  }
  await addFrame(frame);
  renderReadout();
}

async function addFrameRange() {
  const frames = framesInRange();
  const small = frames.length <= largeRangeThreshold;
  const approved = small || confirm(`Add ${frames.length} frames?`);
  if (!approved) return;
  const originalTime = ui.video.currentTime;

  for (const [index, frame] of frames.entries()) {
    const done = index / frames.length;
    reportProgress(`Adding frame ${frame}…`, done);
    if (!selection.find(clock, frame)) await addFrame(frame);
  }

  await seekTo(ui.video, originalTime);
  clearStatus();
}

function framesInRange() {
  const from = clock.clampFrame(Number(ui.rangeFrom.value));
  const to = clock.clampFrame(Number(ui.rangeTo.value));
  const every = Math.max(1, Math.floor(Number(ui.rangeEvery.value)));
  const first = Math.min(from, to);
  const last = Math.max(from, to);
  const frames = [];
  for (let frame = first; frame <= last; frame += every) frames.push(frame);
  return frames;
}

async function addFrame(frame) {
  const time = clock.timeOf(frame);
  await seekTo(ui.video, time);
  const thumbnailUrl = captureThumbnail(ui.video);
  selection.add({ time, thumbnailUrl });
}

async function downloadAsZip() {
  const files = await renderSelectedFrames();
  reportProgress("Packing ZIP…");
  const archive = await buildZip(files);
  const archiveName = `${ui.filePrefix.value || "frames"}.zip`;
  downloadBlob(archive, archiveName);
  clearStatus();
}

async function downloadAsFiles() {
  const files = await renderSelectedFrames();

  for (const [index, file] of files.entries()) {
    const done = index / files.length;
    reportProgress(`Downloading ${file.name}…`, done);
    downloadBlob(file.blob, file.name);
    await pause(individualDownloadPauseMilliseconds);
  }

  clearStatus();
}

async function renderSelectedFrames() {
  ui.video.pause();
  const format = imageFormats[ui.imageFormat.value];
  const quality = Number(ui.imageQuality.value);
  const entries = selection.entries;
  const originalTime = ui.video.currentTime;
  const files = [];

  for (const [index, entry] of entries.entries()) {
    const frame = clock.frameAt(entry.time);
    const done = index / entries.length;
    reportProgress(`Rendering frame ${frame}…`, done);
    await seekTo(ui.video, entry.time);
    const blob = await captureFrame(ui.video, format.mimeType, quality);
    const name = frameFileName(frame, format.extension);
    files.push({ name, blob });
  }

  await seekTo(ui.video, originalTime);
  return files;
}

function frameFileName(frame, extension) {
  const width = String(clock.lastFrame).length;
  const paddedFrame = String(frame).padStart(width, "0");
  const prefix = ui.filePrefix.value || "frame";
  return `${prefix}-${paddedFrame}.${extension}`;
}

function renderReadout() {
  if (!clock) return;
  const frame = currentFrame();
  const selected = Boolean(selection.find(clock, frame));
  const time = formatTime(ui.video.currentTime);
  ui.readout.value = `Frame ${frame} / ${clock.lastFrame} · ${time}`;
  ui.scrubber.value = String(frame);
  ui.toggleFrame.textContent = selected ? "Remove frame (S)" : "Add frame (S)";
  ui.toggleFrame.classList.toggle("selected", selected);
}

function renderPlayState() {
  ui.playPause.textContent = ui.video.paused ? "Play" : "Pause";
  renderReadout();
}

function renderSelection() {
  const entries = selection.entries;
  ui.selectionPanel.hidden = entries.length === 0;
  ui.selectionCount.textContent = String(entries.length);
  const items = clock ? entries.map(renderSelectionItem) : [];
  ui.selectionList.replaceChildren(...items);
  renderReadout();
}

function renderSelectionItem(entry) {
  const frame = clock.frameAt(entry.time);
  const item = document.createElement("li");
  item.className = "thumbnail";

  const image = document.createElement("img");
  image.src = entry.thumbnailUrl;
  image.alt = `Frame ${frame}`;
  image.title = "Jump to this frame";
  image.addEventListener("click", () => showFrame(frame));

  const label = document.createElement("span");
  label.textContent = `#${frame} · ${formatTime(entry.time)}`;

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "remove";
  remove.textContent = "×";
  remove.title = "Remove";
  remove.addEventListener("click", () => selection.remove(entry));

  item.append(image, label, remove);
  return item;
}

function renderQualityControl() {
  const format = imageFormats[ui.imageFormat.value];
  ui.imageQuality.disabled = !format.lossy;
}

async function runExclusive(task) {
  if (busy) return;
  busy = true;
  document.body.classList.add("busy");
  try {
    await task();
  } catch (error) {
    reportError(error);
  } finally {
    busy = false;
    document.body.classList.remove("busy");
  }
}

function reportProgress(message, fraction) {
  ui.status.hidden = false;
  ui.status.classList.remove("error");
  ui.statusMessage.textContent = message;
  ui.statusProgress.hidden = fraction === undefined;
  if (fraction !== undefined) ui.statusProgress.value = fraction;
}

function reportError(error) {
  console.error(error);
  ui.status.hidden = false;
  ui.status.classList.add("error");
  ui.statusMessage.textContent = error?.message ?? String(error);
  ui.statusProgress.hidden = true;
}

function clearStatus() {
  ui.status.hidden = true;
}

function formatRate(framesPerSecond) {
  return String(Math.round(framesPerSecond * 1000) / 1000);
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds - minutes * 60;
  const paddedMinutes = String(minutes).padStart(2, "0");
  const paddedSeconds = remainder.toFixed(3).padStart(6, "0");
  return `${paddedMinutes}:${paddedSeconds}`;
}

function pause(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
