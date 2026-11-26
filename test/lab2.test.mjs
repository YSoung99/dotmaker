import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLab } from './load-lab.mjs';

const { lab2Compute, lab2Region, lab2Flatten, labVote, labAutoPalette } = loadLab();
const rgba = (values, i) => [...values.slice(i * 4, i * 4 + 4)];

test('중요 영역은 주변에 묻히는 색을 살리고 알파는 그대로 둔다', () => {
  const w = 32, h = 32, bytes = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) bytes.set([120, 110, 100, 127], i * 4);
  bytes.set([70, 120, 170, 127], (8 * w + 8) * 4);
  const source = { w, h, bytes };
  const options = { mode: 'protect', size: 16, colors: 8, radius: 2 };
  const before = lab2Compute(source, options);
  const region = lab2Region(source, [[8, 8, 9, 9]]);
  const after = lab2Compute(source, { ...options, region });
  assert.deepEqual(rgba(before.picture.bytes, 4 * 16 + 4), [120, 110, 100, 127]);
  assert.deepEqual(rgba(after.picture.bytes, 4 * 16 + 4), [70, 120, 170, 127]);
});

test('색면 정리는 면 안의 잔색을 줄이면서 알파를 그대로 둔다', () => {
  const w = 8, h = 8, bytes = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p++) {
    const shade = p % 8 < 4 ? 70 : 180;
    bytes.set([shade + (p % 3) * 3, shade, shade, 145], p * 4);
  }
  const filtered = lab2Flatten({ w, h, bytes }, 2, null);
  const variance = (array, pixels) => {
    const values = pixels.map(p => array[p * 4]);
    return Math.max(...values) - Math.min(...values);
  };
  const left = [17, 18, 25, 26, 33, 34];
  assert.ok(variance(filtered.bytes, left) < variance(bytes, left));
  assert.ok(filtered.bytes[3 * 4] < 100);
  assert.ok(filtered.bytes[4 * 4] > 150);
  for (let p = 0; p < w * h; p++) assert.equal(filtered.bytes[p * 4 + 3], bytes[p * 4 + 3]);
});

test('AI로 고른 범위 밖은 기본 도트화와 같은 RGBA 값을 유지한다', () => {
  const w = 32, h = 24, bytes = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) bytes.set([i % 255, i * 7 % 255, i * 3 % 255, i % 4 ? 255 : 43], i * 4);
  const source = { w, h, bytes };
  const region = lab2Region(source, [[0, 0, 16, 12]]);
  const base = lab2Compute(source, { mode: 'protect', size: 16, colors: 8 });
  const { picture } = lab2Compute(source, { mode: 'flatten', size: 16, colors: 8, radius: 3, region, local: true });
  assert.deepEqual([picture.w, picture.h], [16, 12]);
  const vote = labVote(source, 2, true, null, true);
  assert.equal(labAutoPalette(vote, 8).length, 8);
  for (let y = 0; y < 12; y++) for (let x = 0; x < 16; x++) {
    if (x < 8 && y < 6) continue;
    const i = y * 16 + x;
    assert.deepEqual(rgba(picture.bytes, i), rgba(base.picture.bytes, i));
  }
});
