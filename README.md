# keyframe-selector

Static Hugo site for picking frames out of a video and downloading them as images. Everything runs in the browser.

## Use

- Load a video from disk (picker or drag and drop) or from an `http(s)` URL.
  - A URL's server must send CORS headers (`Access-Control-Allow-Origin`) and support HTTP Range requests; otherwise the app reports why it cannot read the frames.
- Step with `←`/`→` (`Shift` = 10 frames), `Space` plays/pauses, `S` adds or removes the current frame.
- "Add a range of frames" selects every Nth frame between two frame numbers.
- Export the selection as PNG, JPEG or WebP: one ZIP, or one download per image.

The frame rate is detected from playback (`requestVideoFrameCallback`); when detection is unavailable the field shows "not detected" and must be set by hand.

## Develop

```bash
hugo server
```

## Build

```bash
hugo --gc --minify
```

`public/` is the deployable static site.
