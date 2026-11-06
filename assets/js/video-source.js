import { BlobSource, UrlSource } from "mediabunny";

export class InvalidVideoUrlError extends Error {
  constructor(link) {
    super(`"${link}" is not an http(s) URL.`);
    this.name = "InvalidVideoUrlError";
  }
}

export class VideoSource {
  #openMediaSource;

  constructor(url, name, crossOrigin, release, openMediaSource) {
    this.url = url;
    this.name = name;
    this.crossOrigin = crossOrigin;
    this.release = release;
    this.#openMediaSource = openMediaSource;
  }

  static fromFile(file) {
    const objectUrl = URL.createObjectURL(file);
    const revoke = () => URL.revokeObjectURL(objectUrl);
    const openBlob = () => new BlobSource(file);
    return new VideoSource(objectUrl, file.name, null, revoke, openBlob);
  }

  static fromLink(link) {
    const parsed = parseHttpUrl(link);
    const name = lastPathSegment(parsed);
    const keep = () => {};
    const openUrl = () => new UrlSource(parsed.href);
    return new VideoSource(parsed.href, name, "anonymous", keep, openUrl);
  }

  get stem() {
    const withoutExtension = this.name.replace(/\.[^.]+$/, "");
    const sanitized = withoutExtension.replace(/[^\w.-]+/g, "-");
    return sanitized || "frame";
  }

  openMediaSource() {
    return this.#openMediaSource();
  }
}

function parseHttpUrl(link) {
  let parsed;
  try {
    parsed = new URL(link);
  } catch {
    throw new InvalidVideoUrlError(link);
  }
  const isHttp = parsed.protocol === "http:" || parsed.protocol === "https:";
  if (!isHttp) throw new InvalidVideoUrlError(link);
  return parsed;
}

function lastPathSegment(parsed) {
  const segments = parsed.pathname.split("/").filter(Boolean);
  const last = segments.at(-1) ?? parsed.hostname;
  return decodeURIComponent(last);
}
