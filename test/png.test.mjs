import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { encodePNG } from '../src/png.js';

test('PNG 저장은 반투명 픽셀의 RGB와 알파를 그대로 넣는다', async () => {
  const bytes = Uint8ClampedArray.of(39, 127, 219, 2, 16, 80, 127, 255, 77, 173, 202, 67, 11, 12, 13, 0);
  const png = Buffer.from(await (await encodePNG({ w: 2, h: 2, bytes })).arrayBuffer());
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(png.readUInt32BE(16), 2);
  assert.equal(png.readUInt32BE(20), 2);
  assert.equal(png[25], 6);
  const data = [];
  for (let at = 8; at < png.length;) {
    const length = png.readUInt32BE(at);
    if (png.subarray(at + 4, at + 8).toString() === 'IDAT') data.push(png.subarray(at + 8, at + 8 + length));
    at += length + 12;
  }
  const scan = inflateSync(Buffer.concat(data));
  assert.deepEqual([...scan], [0, ...bytes.slice(0, 8), 0, ...bytes.slice(8)]);
});
