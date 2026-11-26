// 도트화 순수 계산(src/core.js) 스냅샷 테스트. 작업자(worker.js)가 부르는 순서를 그대로 따른다.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../src/core.js';
import { character } from './pictures.mjs';
import { snapshots, sha256 } from './snapshot.mjs';

/** 곧은 RGBA 그림을 작업자가 받는 프리멀티플라이 바이트로 */
function premultiplied({ w, h, bytes }) {
  const data = new Uint8Array(bytes.length);
  for (let i = 0; i < data.length; i += 4) {
    const a = bytes[i + 3];
    for (let k = 0; k < 3; k++) data[i + k] = Math.floor((bytes[i + k] * a + 127) / 255);
    data[i + 3] = a;
  }
  return { w, h, data };
}

const original = premultiplied(character(120, 120));
const SIZE = 50;
const matchSnapshot = snapshots('core');

/** worker.js의 finish()와 같은 갈래: 원본 보존은 원본에서 바로 격자를 읽는다. */
function dot(settings) {
  const subject = core.Subject.extract(original, null, true);
  return core.render(subject, core.reduceDirect(subject, SIZE, SIZE), settings);
}

const variants = {
  '원본 보존': { method: 'faithful' },
  '원본 보존 + 또렷하게·바깥 외곽선·색 맞추기·섞인 색·입선': { method: 'faithful', sharpCells: true, crispOutline: true, snapColors: true, cleanBlends: true, preserveMouth: true },
  '원본 보존 + 반투명 없애기·외톨이 점·PICO-8': { method: 'faithful', hardEdge: true, lonePixels: true, palette: 'pico8' },
};

for (const [name, change] of Object.entries(variants)) {
  test(`render: ${name}`, () => {
    const settings = { ...core.defaultSettings(), upscale: 'off', ...change };
    const dotted = dot(settings);
    const { w, h } = dotted.image.grid;
    assert.deepEqual([w, h], [SIZE, SIZE]);
    matchSnapshot(name, { status: core.dotStatus(settings, dotted), sha256: sha256(dotted.image.straightBytes()) });
  });
}

test('parsePalette: 16진수 색을 쉼표로 받아 읽는다', () => {
  assert.equal(core.parsePalette('#1a1c2c, f4f4f4, ff77a8').length, 3);
});

test('바깥 외곽선은 반투명 장식과 그림자의 알파를 바꾸지 않는다', () => {
  const input = new core.Raster(5, 5);
  input.px[6] = core.pack(40, 35, 40, 255);
  input.px[7] = core.pack(40, 40, 40, 180);
  input.px[12] = core.pack(110, 110, 110, 100);
  const output = core.crispOutline(input);
  assert.deepEqual(Array.from(output.px, core.A), Array.from(input.px, core.A));
});

test('검정 테두리 겹침은 바깥 반투명 검정 계열만 같은 자리에서 겹친다', () => {
  const input = new core.Raster(6, 6);
  for (let y = 2; y <= 4; y++) {
    for (let x = 2; x <= 4; x++) input.px[y * 6 + x] = core.pack(80, 80, 80);
  }
  input.px[21] = core.pack(0, 0, 0, 25); // 불투명 픽셀로 둘러싸인 안쪽 검정
  input.px[1] = core.pack(190, 20, 20, 25); // 바깥 색상 픽셀
  input.px[8] = core.pack(12, 18, 20, 3); // 바깥 아주 옅은 검정 계열
  input.px[6] = core.pack(0, 0, 0, 25); // 바깥 검정
  assert.equal(core.outlineStackLayers(1), 10);
  assert.equal(core.outlineStackLayers(50), 500);
  assert.equal(core.stackDarkOutline(input, 0), input);
  assert.equal(core.stackDarkOutline(input, 1), input);
  const first = core.stackDarkOutline(input, 10);
  assert.equal(first.px[6], core.pack(0, 0, 0, 164));
  assert.equal(first.px[8], core.pack(12, 18, 20, 28));
  assert.equal(first.px[21], input.px[21]);
  assert.equal(first.px[1], input.px[1]);
  assert.equal(first.px[0], 0);
  assert.equal(first.px[20], input.px[20]);
  assert.equal(core.stackDarkOutline(input, 500).px[8], core.pack(12, 18, 20, 254));
});
