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

/** worker.js의 finish()와 같은 갈래: 원본 보존·원본 직행은 원본에서 바로 격자를 읽는다. */
function dot(settings) {
  if (settings.method === 'faithful') {
    const subject = core.Subject.extract(original, null, true);
    return core.render(subject, core.reduceDirect(subject, SIZE, SIZE), settings);
  }
  const prepared = core.prepare(original, SIZE, SIZE);
  const reduced = settings.method === 'direct' ? core.reduceDirect(prepared.subject, SIZE, SIZE) : prepared.reduced;
  return core.render(prepared.subject, reduced, settings);
}

const variants = {
  '원본 보존': { method: 'faithful' },
  '원본 보존 + 또렷하게·바깥 외곽선·색 맞추기·섞인 색·입선': { method: 'faithful', sharpCells: true, crispOutline: true, snapColors: true, cleanBlends: true, preserveMouth: true },
  '원본 색 살림': { method: 'soft' },
  '베리 잉크': { method: 'berry' },
  '2.0 방식 2줄 외곽선': { method: 'basic', width: 2 },
  '원본 직행 + 반투명 없애기·외톨이 점·PICO-8': { method: 'direct', hardEdge: true, lonePixels: true, palette: 'pico8' },
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
