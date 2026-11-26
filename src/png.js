// 캔버스의 반투명 색 반올림을 거치지 않고 원래 RGBA를 PNG로 저장한다.
const pngCRC = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let i = 0; i < 8; i++) value = (value & 1 ? 0xedb88320 : 0) ^ (value >>> 1);
  return value >>> 0;
});

function pngChunk(name, bytes) {
  const chunk = new Uint8Array(bytes.length + 12);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, bytes.length);
  chunk.set(new TextEncoder().encode(name), 4);
  chunk.set(bytes, 8);
  let crc = 0xffffffff;
  for (let i = 4; i < chunk.length - 4; i++) crc = pngCRC[(crc ^ chunk[i]) & 255] ^ (crc >>> 8);
  view.setUint32(chunk.length - 4, crc ^ 0xffffffff);
  return chunk;
}

export async function encodePNG({ w, h, bytes }) {
  const header = new Uint8Array(13), info = new DataView(header.buffer);
  info.setUint32(0, w);
  info.setUint32(4, h);
  header[8] = 8;  // 채널당 8비트
  header[9] = 6;  // RGBA
  const stride = w * 4 + 1, scan = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const start = y * w * 4;
    scan.set(bytes.subarray(start, start + w * 4), y * stride + 1);  // 필터 0
  }
  const compressed = new Blob([scan]).stream().pipeThrough(new CompressionStream('deflate'));
  const data = new Uint8Array(await new Response(compressed).arrayBuffer());
  return new Blob([
    Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
    pngChunk('IHDR', header),
    pngChunk('sRGB', Uint8Array.of(0)),
    pngChunk('IDAT', data),
    pngChunk('IEND', new Uint8Array(0)),
  ], { type: 'image/png' });
}
