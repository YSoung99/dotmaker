// 실험 탭 순수 계산(src/lab-core.js) 스냅샷 테스트
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLab } from './load-lab.mjs';
import { character, scene } from './pictures.mjs';
import { snapshots, sha256 } from './snapshot.mjs';

const lab = loadLab();
const matchSnapshot = snapshots('lab');
const BASE16 = ['000000', '0000ff', 'ff0000', 'ff00ff', '00ff00', '00ffff', 'ffff00', 'ffffff'];
const custom = BASE16.map(hex => [0, 2, 4].map(k => parseInt(hex.slice(k, k + 2), 16)));

const cases = {
  'character 평균 4px 자동 16색': [character(), { method: 'average', wanted: 4, count: 16, palette: null }],
  'character 투표 3px 디테일·틈 메우기': [character(), { method: 'vote', wanted: 3, protect: true, repair: true, count: 16, palette: null }],
  'character 투표 3px 커스텀 8색': [character(), { method: 'vote', wanted: 3, protect: false, repair: false, count: 8, palette: custom }],
  'scene 평균 긴 변 50칸 자동 8색': [scene(), { method: 'average', wanted: 120 / 50, count: 8, palette: null }],
  'scene 투표 5px 디테일·틈 메우기': [scene(), { method: 'vote', wanted: 5, protect: true, repair: true, count: 16, palette: null }],
};

for (const [name, [picture, options]] of Object.entries(cases)) {
  test(`labCompute: ${name}`, () => {
    const r = lab.labCompute(picture, options);
    assert.equal(r.bytes.length, r.w * r.h * 4);
    matchSnapshot(name, { size: `${r.w}x${r.h}`, kept: r.kept, mended: r.mended, used: r.used, sha256: sha256(r.bytes) });
  });
}

test('labAutoPalette: 색이 count 이하면 그 색들을 그대로 돌려준다', () => {
  const picture = { w: 2, h: 1, bytes: new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]) };
  assert.deepEqual(Array.from(lab.labAutoPalette(picture, 8), c => Array.from(c)).sort(), [[0, 0, 255], [255, 0, 0]]);
});

test('labShrink: 절반 넘게 투명한 칸은 투명', () => {
  const bytes = new Uint8ClampedArray(4 * 4 * 4);
  bytes.set([10, 20, 30, 255], 0);   // 2×2 칸 중 한 픽셀만 칠함
  const r = lab.labShrink({ w: 4, h: 4, bytes }, 2);
  assert.equal(r.bytes[3], 0);
});

// ── 메이플 램프(src/maple.js)
const maple = (outline, extra = {}) => ({ materials: 8, tones: 3, outline, hueShift: true, boundary: true, ...extra });
const mapleCases = {
  'character 메이플 진한 잉크': [character(), maple('ink')],
  'character 메이플 재질 색 윤곽선': [character(), maple('material')],
  'character 메이플 윤곽선 없음·휴 시프트 끔': [character(), maple('none', { hueShift: false, boundary: false })],
  'scene 메이플 재질 4·음영 5': [scene(), maple('material', { materials: 4, tones: 5 })],
};
for (const [name, [picture, options]] of Object.entries(mapleCases)) {
  test(`labCompute: ${name}`, () => {
    const r = lab.labCompute(picture, { method: 'maple', wanted: 3, maple: options });
    assert.equal(r.bytes.length, r.w * r.h * 4);
    matchSnapshot(name, { size: `${r.w}x${r.h}`, materials: r.materials, specks: r.specks, used: r.used, sha256: sha256(r.bytes) });
  });
}

test('메이플 진한 잉크: 바깥 테두리는 잉크 색(#1D1514) 한 가지', () => {
  const r = lab.labCompute(character(), { method: 'maple', wanted: 3, maple: maple('ink') });
  const y = r.h >> 1, row = [...Array(r.w).keys()].map(x => Array.from(r.bytes.slice((y * r.w + x) * 4, (y * r.w + x) * 4 + 4)));
  const first = row.find(p => p[3] === 255);
  assert.deepEqual(first, [0x1d, 0x15, 0x14, 255]);
});

test('메이플 윤곽선 없음: 잉크 색을 쓰지 않는다', () => {
  const r = lab.labCompute(character(), { method: 'maple', wanted: 3, maple: maple('none') });
  for (let i = 0; i < r.bytes.length; i += 4) assert.ok(!(r.bytes[i] === 0x1d && r.bytes[i + 1] === 0x15 && r.bytes[i + 2] === 0x14));
});

test('OKLab 왕복: sRGB → OKLab → sRGB가 같은 색', () => {
  for (const rgb of [[0, 0, 0], [255, 255, 255], [29, 21, 20], [200, 120, 33], [12, 200, 250]]) {
    assert.deepEqual(Array.from(lab.mapleEncode(lab.mapleDecode(...rgb))), rgb);
  }
});

test('메이플 진한 잉크는 어두운 오브젝트의 바깥 테두리에도 적용된다', () => {
  const bytes = new Uint8ClampedArray(10 * 10 * 4);
  for (let y = 3; y < 6; y++) {
    for (let x = 3; x < 6; x++) bytes.set([20, 20, 20, 255], (y * 10 + x) * 4);
  }
  const result = lab.labCompute({ w: 10, h: 10, bytes }, { method: 'maple', wanted: 1, maple: maple('ink') });
  assert.deepEqual(Array.from(result.bytes.slice(132, 136)), [29, 21, 20, 255]);
  assert.deepEqual(Array.from(result.bytes.slice(176, 180)), [20, 20, 20, 255]);
});

test('실험 탭에 빈 커스텀 팔레트가 들어오면 원본에서 색을 고른다', () => {
  const bytes = new Uint8ClampedArray([220, 90, 20, 255]);
  for (const method of ['average', 'vote']) {
    const result = lab.labCompute({ w: 1, h: 1, bytes }, { method, wanted: 1, palette: [], count: 16 });
    assert.deepEqual(Array.from(result.bytes), Array.from(bytes));
  }
});

test('실험 탭은 도트 크기대로 계산할 때도 한 변 최대 250칸을 넘지 않는다', () => {
  const w = 300, h = 150, bytes = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < bytes.length; i += 4) bytes.set([250, 204, 21, 255], i);
  const result = lab.labCompute({ w, h, bytes }, { method: 'average', wanted: 1, palette: null, count: 8 });
  assert.deepEqual([result.w, result.h], [250, 125]);
});
