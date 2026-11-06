export class FrameSelection {
  #entries = [];

  constructor(onChange) {
    this.onChange = onChange;
  }

  get entries() {
    return [...this.#entries];
  }

  get size() {
    return this.#entries.length;
  }

  find(clock, frame) {
    return this.#entries.find((entry) => clock.frameAt(entry.time) === frame);
  }

  add(entry) {
    this.#entries.push(entry);
    this.#entries.sort((earlier, later) => earlier.time - later.time);
    this.onChange();
  }

  remove(entry) {
    this.#entries = this.#entries.filter((candidate) => candidate !== entry);
    this.onChange();
  }

  clear() {
    this.#entries = [];
    this.onChange();
  }
}
