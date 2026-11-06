# keyframe-selector

Static Hugo site with two workflows on one video, both running entirely in the browser:

- **Frames**: pick frames and download them as images.
- **Clip**: cut a frame-accurate segment and export it as a video at a chosen frame rate.

## Use

- Load a video from disk (picker or drag and drop) or from an `http(s)` URL.
  - A URL's server must send CORS headers (`Access-Control-Allow-Origin`) and support HTTP Range requests; otherwise the app reports why it cannot read the frames.
- Step with `←`/`→` (`Shift` = 10 frames), `Space` plays/pauses, `S` adds or removes the current frame.
- "Add a range of frames" selects every Nth frame between two frame numbers.
- Export the selection as PNG, JPEG or WebP: one ZIP, or one download per image.
- Clip workflow: `I`/`O` set the in/out frames, `P` plays the clip. Output frame rate is "same as source", a preset or a custom value; the container is MP4 or WebM, with or without audio.
  - Encoding uses WebCodecs through [Mediabunny](https://mediabunny.dev). The codec is the first one the browser can encode (MP4: H.264 → HEVC → VP9 → AV1, audio AAC → Opus; WebM: VP9 → VP8 → AV1, audio Opus → Vorbis); the status bar names the codecs used.

The frame rate is detected from playback (`requestVideoFrameCallback`); when detection is unavailable the field shows "not detected" and must be set by hand.

## Develop

```bash
npm ci --ignore-scripts
hugo server
```

## Build

```bash
hugo --gc --minify
```

`public/` is the deployable static site.
