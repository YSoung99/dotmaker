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
