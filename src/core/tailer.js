import fs from "node:fs";

const MAX_READ = 8 * 1024 * 1024;

export class FileTailer {
  constructor(filePath) {
    this.filePath = filePath;
    this.offset = 0;
    this.pending = Buffer.alloc(0);
  }

  readNew() {
    let fd;
    try {
      fd = fs.openSync(this.filePath, "r");
    } catch {
      return { records: [], reset: false, badLines: 0 };
    }
    const records = [];
    let reset = false;
    let badLines = 0;
    try {
      const size = fs.fstatSync(fd).size;
      if (size < this.offset) {
        this.offset = 0;
        this.pending = Buffer.alloc(0);
        reset = true;
      }
      while (this.offset < size) {
        const len = Math.min(MAX_READ, size - this.offset);
        const buf = Buffer.alloc(len);
        const n = fs.readSync(fd, buf, 0, len, this.offset);
        if (n <= 0) break;
        this.offset += n;
        const data = Buffer.concat([this.pending, buf.subarray(0, n)]);
        const last = data.lastIndexOf(0x0a);
        if (last < 0) { this.pending = data; continue; }
        this.pending = Buffer.from(data.subarray(last + 1));
        const text = data.subarray(0, last).toString("utf8");
        for (const raw of text.split("\n")) {
          const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
          if (!line.trim()) continue;
          try { records.push(JSON.parse(line)); } catch { badLines++; }
        }
      }
    } finally {
      fs.closeSync(fd);
    }
    return { records, reset, badLines };
  }
}
