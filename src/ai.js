// AI 기능(작업자 안에서 돈다). 실행 도구·모델은 files.js의 저장소에서 꺼내 쓰고, 없으면 한 번 받아 저장한다.
// - 배경 분리: 맥판 Vision 대신 skytnt/anime-seg (isnetis.onnx)
// - 선 추출: 맥판 lines.py와 같은 MangaLineExtraction. 구조(ONNX)는 이 파일에 들어 있고,
//   가중치는 허깅페이스 원본(BF16 safetensors)을 Float32로 풀어 외부 데이터 'weights.bin'으로 넘긴다(tools/export-lines.py).
const SEG_SIZE = 1024;
const LINES_GRAPH = '__LINES_GRAPH__';
const LINES_MANIFEST = '__LINES_MANIFEST__';

async function download(id, progress) {
  const file = AI_FILES[id];
  let response;
  try {
    response = await fetch(file.url);
  } catch {
    throw new DotError(`${file.title}을(를) 받지 못했습니다. 인터넷 연결을 확인하거나, 설명서 탭에서 파일을 직접 받아 넣어 주세요.`);
  }
  if (!response.ok) throw new DotError(`${file.title}을(를) 받지 못했습니다. (HTTP ${response.status})`);
  // CDN은 압축해서 보내기도 해서 content-length를 믿지 않고, 풀린 크기를 목록의 크기와 맞춰 본다.
  const reader = response.body.getReader();
  const bytes = new Uint8Array(file.size);
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (received + value.length > bytes.length) throw new DotError(`${file.title} 크기가 예상과 다릅니다.`);
    bytes.set(value, received);
    received += value.length;
    progress(`${file.title} 받는 중 (처음 한 번, ${Math.round(received / 1048576)}/${Math.round(file.size / 1048576)}MB)`);
  }
  if (received !== file.size) throw new DotError(`${file.title} 크기가 예상과 다릅니다.`);
  return bytes;
}

async function aiFile(id, progress) {
  let bytes = await fileStore.get(id);
  if (!bytes) {
    bytes = await download(id, progress);
    await fileStore.put(id, bytes).catch(() => {});
  }
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
}

const blobURL = (bytes, type) => URL.createObjectURL(new Blob([bytes], { type }));

let ortReady = null;
function loadOrt(progress) {
  ortReady ??= (async () => {
    const js = await aiFile('ortJs', progress);
    const mjs = await aiFile('ortMjs', progress);
    const wasm = await aiFile('ortWasm', progress);
    importScripts(blobURL(js, 'text/javascript'));
    self.ort.env.wasm.wasmPaths = { mjs: blobURL(mjs, 'text/javascript') };
    self.ort.env.wasm.wasmBinary = wasm;
    return self.ort;
  })().catch(error => { ortReady = null; throw error; });
  return ortReady;
}
const providers = () => (self.navigator.gpu ? ['webgpu', 'wasm'] : ['wasm']);

// ── 배경 분리
let segSession = null;
async function segmentationSession(progress) {
  if (segSession) return segSession;
  const ort = await loadOrt(progress);
  const bytes = await aiFile('segModel', progress);
  progress('AI 배경 분리 모델 준비 중');
  segSession = await ort.InferenceSession.create(bytes, { executionProviders: providers() });
  return segSession;
}

/** cv2.resize(INTER_LINEAR)와 같은 반 칸 기준 쌍선형. src: Float32Array(채널 c, HWC) */
function bilinear(src, sw, sh, dw, dh, c) {
  const out = new Float32Array(dw * dh * c);
  const sx = sw / dw, sy = sh / dh;
  for (let y = 0; y < dh; y++) {
    const fy = Math.min(sh - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy), y1 = Math.min(sh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < dw; x++) {
      const fx = Math.min(sw - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx), x1 = Math.min(sw - 1, x0 + 1), tx = fx - x0;
      for (let k = 0; k < c; k++) {
        const a = src[(y0 * sw + x0) * c + k], b = src[(y0 * sw + x1) * c + k];
        const d = src[(y1 * sw + x0) * c + k], e = src[(y1 * sw + x1) * c + k];
        out[(y * dw + x) * c + k] = (a + (b - a) * tx) * (1 - ty) + (d + (e - d) * tx) * ty;
      }
    }
  }
  return out;
}

/** 배경을 지운 이미지(프리멀티플라이 바이트, 원본과 같은 크기). image의 원본은 불투명. */
async function removeBackground(image, progress) {
  const session = await segmentationSession(progress);
  progress('AI가 배경을 지우는 중');
  const { w: w0, h: h0, data } = image, s = SEG_SIZE;
  const [h, w] = h0 > w0 ? [s, Math.trunc(s * w0 / h0)] : [Math.trunc(s * h0 / w0), s];
  const top = (s - h) >> 1, left = (s - w) >> 1;
  const rgb = new Float32Array(w0 * h0 * 3);
  for (let i = 0; i < w0 * h0; i++) {
    const a = data[i * 4 + 3] || 1;
    for (let k = 0; k < 3; k++) rgb[i * 3 + k] = Math.min(255, data[i * 4 + k] * 255 / a) / 255;
  }
  const scaled = bilinear(rgb, w0, h0, w, h, 3);
  const input = new Float32Array(3 * s * s);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    for (let k = 0; k < 3; k++) input[k * s * s + (y + top) * s + x + left] = scaled[(y * w + x) * 3 + k];
  }
  const feeds = { [session.inputNames[0]]: new self.ort.Tensor('float32', input, [1, 3, s, s]) };
  const output = (await session.run(feeds))[session.outputNames[0]].data;
  const crop = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) crop[y * w + x] = output[(y + top) * s + x + left];
  const mask = bilinear(crop, w, h, w0, h0, 1);
  const out = new Uint8Array(w0 * h0 * 4);
  for (let i = 0; i < w0 * h0; i++) {
    const a = Math.round(Math.min(1, Math.max(0, mask[i])) * 255);
    for (let k = 0; k < 3; k++) out[i * 4 + k] = Math.round(rgb[i * 3 + k] * a);
    out[i * 4 + 3] = a;
  }
  return { w: w0, h: h0, data: out };
}

// ── 선 추출
let linesSession = null;
async function lineSession(progress) {
  if (linesSession) return linesSession;
  const ort = await loadOrt(progress);
  const file = await aiFile('linesModel', progress);
  progress('선 추출 AI 모델 준비 중');
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const headerLength = Number(view.getBigUint64(0, true));
  const header = JSON.parse(new TextDecoder().decode(file.subarray(8, 8 + headerLength)));
  const start = 8 + headerLength;
  const last = LINES_MANIFEST[LINES_MANIFEST.length - 1];
  const weights = new Uint8Array(last[1] + last[2] * 4);
  const out = new Uint32Array(weights.buffer);
  for (const [key, offset, count] of LINES_MANIFEST) {
    const info = header[key];
    if (!info || info.dtype !== 'BF16') throw new DotError('선 추출 AI 모델 파일이 예상과 다릅니다.');
    const base = start + info.data_offsets[0], first = offset / 4;
    // BF16은 Float32의 위쪽 16비트라서 16비트 밀어 올리면 같은 값이다.
    for (let k = 0; k < count; k++) out[first + k] = view.getUint16(base + k * 2, true) << 16;
  }
  const graph = Uint8Array.from(atob(LINES_GRAPH), c => c.charCodeAt(0));
  linesSession = await ort.InferenceSession.create(graph, {
    executionProviders: providers(),
    externalData: [{ path: 'weights.bin', data: weights }],
  });
  return linesSession;
}

/** 캐릭터(subject)의 구조선 지도: 흰 바탕에 검은 선, 캐릭터와 같은 크기. 맥판 AIDot.extractLines와 같은 입력·출력. */
async function extractLines(subject, progress) {
  const session = await lineSession(progress);
  progress('선 추출 AI가 원본의 선을 읽는 중');
  const w = subject.grid.w, h = subject.grid.h;
  const pw = Math.ceil(w / 16) * 16, ph = Math.ceil(h / 16) * 16;
  const input = new Float32Array(pw * ph).fill(255);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = subject.px[y * w + x], pct = Math.floor(A(p) * 100 / 255);
    const white = c => Math.floor((255 * (100 - pct) + c * pct + 50) / 100);
    // 흰 바탕에 얹은 뒤 PIL 'L' 변환과 같은 회색
    input[y * pw + x] = (white(R(p)) * 19595 + white(G(p)) * 38470 + white(B(p)) * 7471 + 0x8000) >> 16;
  }
  const tensor = new self.ort.Tensor('float32', input, [1, 1, ph, pw]);
  const output = (await session.run({ [session.inputNames[0]]: tensor }))[session.outputNames[0]].data;
  const lines = new Raster(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = Math.trunc(Math.min(255, Math.max(0, output[y * pw + x])));
    lines.px[y * w + x] = pack(v, v, v);
  }
  return lines;
}
