export class InvalidVideoUrlError extends Error {
  constructor(link) {
    super(`"${link}" is not an http(s) URL.`);
    this.name = "InvalidVideoUrlError";
  }
}

export class VideoSource {
  constructor(url, name, crossOrigin, release) {
    this.url = url;
    this.name = name;
    this.crossOrigin = crossOrigin;
    this.release = release;
  }

  static fromFile(file) {
    const objectUrl = URL.createObjectURL(file);
    const revoke = () => URL.revokeObjectURL(objectUrl);
    return new VideoSource(objectUrl, file.name, null, revoke);
  }

  static fromLink(link) {
    const parsed = parseHttpUrl(link);
    const name = lastPathSegment(parsed);
    const keep = () => {};
    return new VideoSource(parsed.href, name, "anonymous", keep);
  }

  get stem() {
    const withoutExtension = this.name.replace(/\.[^.]+$/, "");
    const sanitized = withoutExtension.replace(/[^\w.-]+/g, "-");
    return sanitized || "frame";
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
