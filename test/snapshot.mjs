// 스냅샷 비교: 결과 그림의 sha256을 test/snapshots/<묶음>.json에 적힌 값과 맞춘다(테스트 파일마다 따로 둬서 동시에 돌아도 안 겹친다).
// 계산을 일부러 바꿨으면 `UPDATE_SNAPSHOTS=1 npm test`로 새 값을 적고, 바뀐 결과를 눈으로 확인한 뒤 올린다.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function snapshots(group) {
  const file = new URL(`./snapshots/${group}.json`, import.meta.url);
  const saved = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  return (name, value) => {
    if (process.env.UPDATE_SNAPSHOTS === '1') {
      saved[name] = value;
      writeFileSync(file, JSON.stringify(saved, null, 2) + '\n');
      return;
    }
    assert.ok(name in saved, `스냅샷 '${name}'이 없습니다. UPDATE_SNAPSHOTS=1 npm test로 만드세요.`);
    assert.deepEqual(value, saved[name], `스냅샷 '${name}'이 달라졌습니다.`);
  };
}
