import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FileTailer } from "../src/core/tailer.js";

function tmp() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tailer-"));
  return path.join(d, "x.jsonl");
}

test("two lines", () => {
  const f = tmp();
  fs.writeFileSync(f, '{"a":1}\n{"a":2}\n');
  const t = new FileTailer(f);
  assert.equal(t.readNew().records.length, 2);
  assert.equal(t.readNew().records.length, 0);
});

test("partial line", () => {
  const f = tmp();
  fs.writeFileSync(f, '{"a":');
  const t = new FileTailer(f);
  assert.equal(t.readNew().records.length, 0);
  fs.appendFileSync(f, "1}\r\n");
  const r = t.readNew();
  assert.equal(r.records.length, 1);
  assert.equal(r.records[0].a, 1);
});

test("split multibyte", () => {
  const f = tmp();
  const buf = Buffer.from('{"t":"한글"}\n', "utf8");
  const cut = buf.indexOf(Buffer.from("한")) + 1;
  fs.writeFileSync(f, buf.subarray(0, cut));
  const t = new FileTailer(f);
  assert.equal(t.readNew().records.length, 0);
  fs.appendFileSync(f, buf.subarray(cut));
  assert.equal(t.readNew().records[0].t, "한글");
});

test("bad line", () => {
  const f = tmp();
  fs.writeFileSync(f, 'not json\n{"a":1}\n');
  const r = new FileTailer(f).readNew();
  assert.equal(r.badLines, 1);
  assert.equal(r.records.length, 1);
});

test("shrink resets", () => {
  const f = tmp();
  fs.writeFileSync(f, '{"a":1}\n{"a":2}\n{"a":3}\n');
  const t = new FileTailer(f);
  t.readNew();
  fs.writeFileSync(f, '{"b":1}\n');
  const r = t.readNew();
  assert.equal(r.reset, true);
  assert.equal(r.records.length, 1);
  assert.equal(r.records[0].b, 1);
});

test("missing file", () => {
  const r = new FileTailer(path.join(os.tmpdir(), "nope-" + Date.now() + ".jsonl")).readNew();
  assert.deepEqual(r, { records: [], reset: false, badLines: 0 });
});


// ---- 보강: 경계값 ----

test("tailer 경계: 빈 파일, 빈 줄, 크기 동일(reset 아님), 축소 뒤 재증가", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tailer-"));
  try {
    const f = path.join(d, "x.jsonl");
    fs.writeFileSync(f, "");
    const t = new FileTailer(f);
    assert.deepEqual(t.readNew(), { records: [], reset: false, badLines: 0 });
    fs.appendFileSync(f, '\n\n{"a":1}\n\n   \nnot json\n');
    const r = t.readNew();
    assert.equal(r.records.length, 1);
    assert.equal(r.badLines, 1); // 빈 줄/공백만 있는 줄은 건너뛰고, 깨진 줄만 센다
    assert.equal(t.readNew().reset, false);
    fs.writeFileSync(f, '{"b":1}\n');
    const shrunk = t.readNew();
    assert.equal(shrunk.reset, true);
    assert.deepEqual(shrunk.records, [{ b: 1 }]);
    fs.appendFileSync(f, '{"b":2}\n');
    assert.deepEqual(t.readNew(), { records: [{ b: 2 }], reset: false, badLines: 0 });
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
