import fs from "node:fs";

export class StateStore {
  constructor(file) {
    this.file = file;
    this.data = this.#load();
  }

  #load() {
    try {
      return JSON.parse(fs.readFileSync(this.file, "utf8"));
    } catch {
      return {};
    }
  }

  get(key, fallback = undefined) {
    return this.data[key] ?? fallback;
  }

  set(key, value) {
    this.data[key] = value;
    this.save();
  }

  delete(key) {
    delete this.data[key];
    this.save();
  }

  save() {
    const temporary = `${this.file}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(this.data, null, 2), "utf8");
    fs.renameSync(temporary, this.file);
  }
}
