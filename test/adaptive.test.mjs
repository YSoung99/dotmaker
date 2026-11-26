// 내용 적응형 축소 네이티브 헬퍼가 맥·윈도우·리눅스에서 같은 바이트를 내는지 고정 값으로 확인한다.
// 헬퍼는 빌드(node tools/build.mjs) 때 dist/native/에 생긴다. 없으면 건너뛴다.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const helper = fileURLToPath(new URL(`../dist/native/dotmaker-adaptive${process.platform === 'win32' ? '.exe' : ''}`, import.meta.url));

function fixture(w, h) {
  const bytes = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const inside = (x - 50) ** 2 + (y - 40) ** 2 < 38 ** 2;
    bytes.set([(x * 9) % 256, (y * 7) % 256, ((x + y) * 3) % 256, inside ? 255 : (x * y) % 17 === 0 ? 128 : 0], i);
  }
  return bytes;
}

test('내용 적응형 축소 결과가 모든 운영체제에서 같다', { skip: !existsSync(helper) && '네이티브 헬퍼가 아직 빌드되지 않았습니다' }, () => {
  const out = execFileSync(helper, ['110', '88', '37', '29'], { input: fixture(110, 88) });
  assert.equal(out.length, 37 * 29 * 4);
  assert.equal(createHash('sha256').update(out).digest('hex'), '0bf8ad39cce23bdfa925c48c6fdf5f883dd2528c0894827eb5d9f9b758c8d2c2');
});
