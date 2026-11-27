// AI 기능(작업자 안에서 돈다). 실행 도구·모델은 files.js의 저장소에서 꺼내 쓰고, 없으면 한 번 받아 저장한다.
// - 배경 분리: 맥판 Vision 대신 skytnt/anime-seg (isnetis.onnx)
const SEG_SIZE = 1024;
// 받는 도중 이만큼 아무것도 오지 않으면 끊긴 것으로 보고 이어받는다. 진행률은 1MB마다만 알린다.
const DOWNLOAD_IDLE_MS = 30000, DOWNLOAD_PROGRESS_STEP = 1048576;

// navigator.gpu가 있어도 쓸 수 있는 GPU(어댑터)가 없을 수 있어서, 작업자를 켤 때 한 번 실제로 물어본다.
let gpuAvailable = false;
const gpuCheck = (async () => {
  try {
    const adapter = await Promise.race([self.navigator.gpu?.requestAdapter(), new Promise(done => setTimeout(done, 3000, null))]);
    gpuAvailable = Boolean(adapter);
  } catch {
    gpuAvailable = false;
  }
})();

/** 저장소 이름에 sha256을 붙여, 파일 목록이 바뀌면(새 버전) 예전 파일을 쓰지 않는다. */
const storeKey = id => `${id}:${AI_FILES[id].sha256}`;

async function download(id, progress) {
  const file = AI_FILES[id];
  const bytes = new Uint8Array(file.size);
  let received = 0, resumable = false;
  // 큰 모델은 받는 도중 연결이 끊기기 쉬워서, 끊기면 받은 데부터 이어받는다(최대 3번).
  // 압축해서 보내는 서버는 위치가 압축 전후로 달라 이어받을 수 없어 처음부터 다시 받는다.
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    let timer = 0;
    const arm = () => { clearTimeout(timer); timer = setTimeout(() => controller.abort(), DOWNLOAD_IDLE_MS); };
    try {
      if (!resumable) received = 0;
      arm();
      const response = await fetch(file.url, { signal: controller.signal, ...(received ? { headers: { Range: `bytes=${received}-` } } : {}) });
      // 서버 쪽 오류(5xx)는 잠깐 뒤에 다시 받으면 되는 경우가 많아 끊긴 것과 같이 다시 시도한다.
      if (response.status >= 500) throw new Error(`HTTP ${response.status}`);
      if (!response.ok) throw new DotError(`${file.title}을(를) 받지 못했습니다. (HTTP ${response.status})`);
      // 서버가 이어받기를 무시하고 처음부터 보내면 처음부터 다시 센다.
      if (received && response.status !== 206) received = 0;
      resumable = !response.headers.get('content-encoding') && response.headers.get('accept-ranges') === 'bytes';
      // CDN은 압축해서 보내기도 해서 content-length를 믿지 않고, 풀린 크기를 목록의 크기와 맞춰 본다.
      const reader = response.body.getReader();
      let reported = -Infinity;
      for (;;) {
        arm();
        const { done, value } = await reader.read();
        if (done) break;
        if (received + value.length > bytes.length) throw new DotError(`${file.title} 크기가 예상과 다릅니다.`);
        bytes.set(value, received);
        received += value.length;
        if (received - reported >= DOWNLOAD_PROGRESS_STEP || received === file.size) {
          reported = received;
          progress(`${file.title} 받는 중 (처음 한 번, ${Math.round(received / 1048576)}/${Math.round(file.size / 1048576)}MB)`);
        }
      }
      break;
    } catch (error) {
      if (error instanceof DotError) throw error;
      if (attempt >= 3) throw new DotError(`${file.title}을(를) 받지 못했습니다. 인터넷 연결을 확인하거나, 설명서 탭에서 파일을 직접 받아 넣어 주세요.`);
      progress(`${file.title} 연결이 끊겨 이어받는 중 (${attempt + 1}/3)`);
      await new Promise(done => setTimeout(done, 1500 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }
  if (received !== file.size) throw new DotError(`${file.title} 크기가 예상과 다릅니다.`);
  if (!(await matchesHash(id, bytes))) throw new DotError(`${file.title} 내용이 원본과 다릅니다(sha256 불일치). 다시 받거나, 설명서 탭에서 파일을 직접 받아 넣어 주세요.`);
  return bytes;
}

async function aiFile(id, progress) {
  const key = storeKey(id);
  let bytes = await fileStore.get(key);
  if (!bytes) {
    // 예전 이름(sha256 없이 id만)으로 저장된 파일은 내용이 맞으면 새 이름으로 옮겨 다시 받지 않는다.
    const legacy = await fileStore.get(id);
    if (legacy && await matchesHash(id, legacy instanceof Uint8Array ? legacy : new Uint8Array(legacy))) {
      bytes = legacy;
      try {
        await fileStore.put(key, legacy);
        await fileStore.run('readwrite', s => s.delete(id));
      } catch (error) {
        console.error(error);
      }
    }
  }
  if (!bytes) {
    bytes = await download(id, progress);
    try {
      await fileStore.put(key, bytes);
    } catch (error) {
      console.error(error);
      progress(`${AI_FILES[id].title}을(를) 저장하지 못했습니다(저장 공간 부족 등). 이번에는 그대로 쓰고, 다음에 다시 받습니다.`);
    }
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
const providers = () => (gpuAvailable ? ['webgpu', 'wasm'] : ['wasm']);

// 만들어 둔 AI 세션(모델 id별). { id, session, wasm }
const aiSessions = {};

async function aiSession(id, label, progress) {
  if (aiSessions[id]) return aiSessions[id];
  const ort = await loadOrt(progress);
  const bytes = await aiFile(id, progress);
  progress(label);
  const session = await ort.InferenceSession.create(bytes, { executionProviders: providers() });
  aiSessions[id] = { id, session, wasm: !gpuAvailable };
  return aiSessions[id];
}

async function releaseSession(id) {
  const entry = aiSessions[id];
  delete aiSessions[id];
  try { await entry?.session.release(); } catch (error) { console.error(error); }
}

/** 메모리에 올린 AI 세션을 모두 놓는다(저장된 AI 파일 지우기). 실패해도 다음 일은 계속한다. */
async function releaseAI() {
  for (const id of Object.keys(aiSessions)) await releaseSession(id);
}

/** 세션 실행. GPU에서 실패하면(장치 끊김·메모리 부족 등) 세션을 버리고 wasm으로 한 번만 다시 만들어 다시 돌린다. */
async function runSafely(entry, feeds, progress) {
  try {
    return await entry.session.run(feeds);
  } catch (error) {
    if (entry.wasm) throw error;
    console.error(error);
    await releaseSession(entry.id);
    progress('GPU에서 AI를 돌리지 못해 CPU로 다시 준비하는 중');
    const session = await self.ort.InferenceSession.create(await aiFile(entry.id, progress), { executionProviders: ['wasm'] });
    Object.assign(entry, { session, wasm: true });
    aiSessions[entry.id] = entry;
    return session.run(feeds);
  }
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
  const entry = await aiSession('segModel', 'AI 배경 분리 모델 준비 중', progress);
  progress('AI가 배경을 지우는 중');
  const { w: w0, h: h0, data } = image, s = SEG_SIZE;
  const [h, w] = h0 > w0 ? [s, Math.trunc(s * w0 / h0)] : [Math.trunc(s * h0 / w0), s];
  const top = (s - h) >> 1, left = (s - w) >> 1;
  // 원본 크기의 실수 배열을 따로 만들지 않고, 바이트에서 바로 줄여 입력 칸에 넣는다(반 칸 기준 쌍선형, bilinear와 같은 계산).
  const straight = (i, k) => Math.min(255, data[i * 4 + k] * 255 / (data[i * 4 + 3] || 1)) / 255;
  const input = new Float32Array(3 * s * s);
  const sx = w0 / w, sy = h0 / h;
  for (let y = 0; y < h; y++) {
    const fy = Math.min(h0 - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy), y1 = Math.min(h0 - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(w0 - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx), x1 = Math.min(w0 - 1, x0 + 1), tx = fx - x0;
      const p00 = y0 * w0 + x0, p01 = y0 * w0 + x1, p10 = y1 * w0 + x0, p11 = y1 * w0 + x1;
      for (let k = 0; k < 3; k++) {
        const a = straight(p00, k), b = straight(p01, k), d = straight(p10, k), e = straight(p11, k);
        input[k * s * s + (y + top) * s + x + left] = (a + (b - a) * tx) * (1 - ty) + (d + (e - d) * tx) * ty;
      }
    }
  }
  const session = entry.session;
  const feeds = { [session.inputNames[0]]: new self.ort.Tensor('float32', input, [1, 3, s, s]) };
  const output = (await runSafely(entry, feeds, progress))[session.outputNames[0]].data;
  const crop = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) crop[y * w + x] = output[(y + top) * s + x + left];
  const mask = bilinear(crop, w, h, w0, h0, 1);
  const out = new Uint8Array(w0 * h0 * 4);
  // 모델은 몸통도 0.85~0.99로만 확신해서 그대로 쓰면 캐릭터 전체가 비친다(맥판과 같은 보정).
  // 0.8 이상은 불투명, 0.2 이하(흐린 배경 찌꺼기)는 투명, 그 사이만 반투명으로 편다.
  for (let i = 0; i < w0 * h0; i++) {
    const a = Math.round(Math.min(1, Math.max(0, (mask[i] - 0.2) / 0.6)) * 255);
    for (let k = 0; k < 3; k++) out[i * 4 + k] = Math.round(straight(i, k) * a);
    out[i * 4 + 3] = a;
  }
  return { w: w0, h: h0, data: out };
}

// ── AI 업스케일(ESRGAN): Real-ESRGAN(xinntao, BSD-3) 애니 모델 두 개를 ONNX로 바꾼 것(맥판과 같은 파일).
// 도트화하기 전에 원본을 4배로 키워 흐린 선·잡티를 정리한다.
const UPSCALE_TILE = 160, UPSCALE_PAD = 10, UPSCALE_MAX = 1024;
const UPSCALE_MODELS = ['esr6b', 'esrV3'];

/** 이 원본에 쓸 모델(AI 파일 id). 자동은 원본이 결과 크기의 4배보다 작을 때만, GPU가 있으면 6B·없으면 빠른 v3. */
function upscaleModel(image, mode, target) {
  if (mode === 'strong') return 'esr6b';
  if (mode === 'light') return 'esrV3';
  if (mode === 'auto' && Math.max(image.w, image.h) < target * 4) return gpuAvailable ? 'esr6b' : 'esrV3';
  return null;
}

/** 타일 시작 위치(한 축). 모든 타일을 같은 크기 n으로 두고, 이웃과 2*UPSCALE_PAD 이상 겹치게 하며, 마지막 타일은 끝에 붙인다. */
function tileStarts(size, n) {
  const starts = [];
  for (let s = 0; ; s += n - 2 * UPSCALE_PAD) {
    if (s + n >= size) { starts.push(size - n); break; }
    starts.push(s);
  }
  return starts;
}

/** 한 축의 타일별 섞는 비율(키운 크기 기준). 이웃과 겹치는 쪽만 가장자리에서 0→1로 늘리고, 겹친 곳의 합이 1이 되게 나눈다. */
function tileWeights(starts, n, size) {
  const ramp = 2 * UPSCALE_PAD * 4, len = n * 4;
  const raw = starts.map(s => Float32Array.from({ length: len }, (_, u) => {
    let w = 1;
    if (s > 0) w = Math.min(w, (u + 0.5) / ramp);
    if (s + n < size) w = Math.min(w, (len - u - 0.5) / ramp);
    return w;
  }));
  const sum = new Float32Array(size * 4);
  starts.forEach((s, t) => { for (let u = 0; u < len; u++) sum[s * 4 + u] += raw[t][u]; });
  starts.forEach((s, t) => { for (let u = 0; u < len; u++) raw[t][u] /= sum[s * 4 + u]; });
  return raw;
}

/** 원본(프리멀티플라이 바이트)을 4배로 키운 그림. 투명한 곳은 가까운 그림 색으로 채워 돌리고 투명도는 따로 키운다. */
async function upscaleImage(image, id, progress) {
  // 다른 업스케일 모델로 바꾸면 앞 모델 세션은 놓는다(둘 다 메모리에 쌓이지 않게).
  for (const other of UPSCALE_MODELS) if (other !== id && aiSessions[other]) await releaseSession(other);
  const entry = await aiSession(id, 'AI 업스케일 모델 준비 중', progress);
  let { w, h } = image;
  let rgba = new Float32Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const a = image.data[i * 4 + 3];
    for (let k = 0; k < 3; k++) rgba[i * 4 + k] = a ? Math.min(255, image.data[i * 4 + k] * 255 / a) : 0;
    rgba[i * 4 + 3] = a;
  }
  // 직접 고른 경우에도 아주 큰 원본은 먼저 줄인다(키워도 차이가 없고 시간만 든다).
  if (Math.max(w, h) > UPSCALE_MAX) {
    const s = UPSCALE_MAX / Math.max(w, h), nw = Math.max(1, Math.trunc(w * s)), nh = Math.max(1, Math.trunc(h * s));
    rgba = bilinear(rgba, w, h, nw, nh, 4);
    w = nw; h = nh;
  }
  // 반투명 그림자·안티에일리어싱 가장자리도 제 색을 지키게, 거의 투명한 곳(16 미만)만 이웃 색으로 채운다.
  const solid = new Uint8Array(w * h);
  let transparent = false;
  for (let i = 0; i < w * h; i++) { solid[i] = rgba[i * 4 + 3] >= 16; if (rgba[i * 4 + 3] < 255) transparent = true; }
  if (transparent) {
    // 가장 가까운 그림 픽셀의 색으로 투명한 곳을 채운다(배경색이 테두리로 번져 들지 않게).
    const queue = [];
    for (let i = 0; i < w * h; i++) if (solid[i]) queue.push(i);
    for (let n = 0; n < queue.length; n++) {
      const i = queue[n], x = i % w;
      for (const j of [x > 0 ? i - 1 : -1, x + 1 < w ? i + 1 : -1, i - w, i + w]) {
        if (j < 0 || j >= w * h || solid[j]) continue;
        solid[j] = 1;
        for (let k = 0; k < 3; k++) rgba[j * 4 + k] = rgba[i * 4 + k];
        queue.push(j);
      }
    }
  }
  // 타일은 모두 같은 크기(WebGPU가 모양마다 셰이더를 다시 만들지 않게)로 겹쳐 돌리고, 겹친 곳은 비율로 섞어 이음새를 없앤다.
  // 섞은 값은 Uint8ClampedArray에 바로 더해 키운 크기만 한 실수 배열을 따로 만들지 않는다(겹친 곳만 ±1 반올림 차이).
  const ow = w * 4, oh = h * 4, out = new Uint8ClampedArray(ow * oh * 4);
  const nw = Math.min(w, UPSCALE_TILE + 2 * UPSCALE_PAD), nh = Math.min(h, UPSCALE_TILE + 2 * UPSCALE_PAD);
  const xs = tileStarts(w, nw), ys = tileStarts(h, nh);
  const wx = tileWeights(xs, nw, w), wy = tileWeights(ys, nh, h);
  const tiles = xs.length * ys.length, plane = nw * 4 * nh * 4, input = new Float32Array(3 * nw * nh);
  let done = 0;
  for (const [ti, y0] of ys.entries()) {
    for (const [tj, x0] of xs.entries()) {
      progress(`AI가 원본을 4배로 키우는 중 (${++done}/${tiles})`);
      for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
        const s = ((y + y0) * w + x + x0) * 4;
        for (let k = 0; k < 3; k++) input[k * nw * nh + y * nw + x] = rgba[s + k] / 255;
      }
      const session = entry.session;
      const feeds = { [session.inputNames[0]]: new self.ort.Tensor('float32', input, [1, 3, nh, nw]) };
      const result = (await runSafely(entry, feeds, progress))[session.outputNames[0]].data;
      const rowWeights = wy[ti], colWeights = wx[tj];
      for (let y = 0; y < nh * 4; y++) {
        for (let x = 0; x < nw * 4; x++) {
          const weight = rowWeights[y] * colWeights[x];
          const s = y * nw * 4 + x, d = ((y0 * 4 + y) * ow + x0 * 4 + x) * 4;
          for (let k = 0; k < 3; k++) out[d + k] += Math.min(1, Math.max(0, result[k * plane + s])) * 255 * weight;
        }
      }
    }
  }
  // 투명도: 키운 크기로 부드럽게 늘린 뒤 프리멀티플라이 바이트로 돌려준다.
  const alpha = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) alpha[i] = rgba[i * 4 + 3];
  const big = transparent ? bilinear(alpha, w, h, ow, oh, 1) : null;
  for (let i = 0; i < ow * oh; i++) {
    const a = big ? Math.round(Math.min(255, Math.max(0, big[i]))) : 255;
    for (let k = 0; k < 3; k++) out[i * 4 + k] = Math.floor((out[i * 4 + k] * a + 127) / 255);
    out[i * 4 + 3] = a;
  }
  return { w: ow, h: oh, data: new Uint8Array(out.buffer) };
}
