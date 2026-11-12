// 도트메이커 화면. 변환·AI는 작업자(worker.js)가 하고, 여기서는 열기·설정·미리보기·저장·설명서만 한다.
const VERSION = '__VERSION__';  // tools/build.mjs가 package.json의 버전을 넣는다
const STAGES = {
  dot: { name: '도트화', instruction: '머리와 몸통을 구분해 검은 윤곽과 몸통 경계색을 적용합니다.' },
  repair: { name: 'AI 보정', instruction: '클라우드 AI(PixelLab·Gemini·OpenAI)에 캐릭터를 보내 도트 그림으로 다시 그립니다. 쓰려면 그 서비스의 내 API 키가 필요합니다.' },
  lab: { name: '실험', instruction: '베타: 캐릭터를 오려 내지 않고 그림 전체를 배경째 도트로 바꿉니다. 도트 크기와 색 수만 고르면 됩니다. 다른 탭의 결과에는 영향을 주지 않습니다.' },
  help: { name: '설명서' },
};

const store = {
  get(key, fallback) { try { return JSON.parse(localStorage.getItem('dotmaker.' + key)) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem('dotmaker.' + key, JSON.stringify(value)); } catch { /* 저장 못 해도 동작에는 지장 없음 */ } },
};

// 마지막에 쓰던 도트화 설정과 결과 크기를 다음에도 쓴다(없어진 항목·형식이 다른 값은 기본값으로).
function savedSettings() {
  const base = defaultSettings(), saved = store.get('settings', {}) ?? {};
  for (const key of Object.keys(base)) if (typeof saved[key] === typeof base[key]) base[key] = saved[key];
  return base;
}
const savedSize = () => String(sizeChoices().includes(store.get('size', null)) ? store.get('size', null) : SETTINGS.size.initial);

const state = {
  stage: 'dot',
  width: savedSize(),
  height: savedSize(),
  settings: savedSettings(),
  compare: false,   // 결과 자리에 원본을 같은 위치·크기로 보여 준다
  aligned: null,    // 비교용 원본 그림(결과 칸에 맞춘 것). 그림이나 크기가 바뀌면 다시 만든다
  notice: null,     // 여러 장 저장·복사 결과 안내
  lab: labInitial(),  // 실험 탭(베타) — lab.js
  retryWhole: null, // 캐릭터 분리에 실패한 파일(‘분리 없이 그대로 변환’ 버튼용)
  exportScale: [1, 2, 4, 8].includes(store.get('exportScale', 1)) ? store.get('exportScale', 1) : 1,
  original: null,   // 원본 미리보기 { w, h, bytes }
  product: null,    // { reduced, dotted, status } — 그림은 { w, h, bytes }
  jev: null,        // JEV 결과 창 { focus, rows, picks, base } 또는 키 설정 창 { settings: true }
  jevApplied: false,
  fileName: null,
  busy: null,
  error: null,
  aiFiles: null,    // 저장된 AI 파일 id 목록(설명서 탭)
  aiMessage: '',
  cloud: {          // AI 보정(클라우드). 고른 서비스와 설정은 다음에도 기억한다.
    provider: ['pixellab', 'gemini', 'openai'].includes(store.get('cloud.provider', 'pixellab')) ? store.get('cloud.provider', 'pixellab') : 'pixellab',
    faithful: store.get('cloud.faithful', true),
    strength: store.get('cloud.strength', 300),
    quality: store.get('cloud.quality', 'medium'),
    mode: store.get('cloud.mode', 'redraw') === 'correct' ? 'correct' : 'redraw',  // PixelLab: 다시 그리기 / 다듬기
    fix: store.get('cloud.fix', 0.1),                                                  // 다듬기 강도 0~1
    editingKey: false,
    input: null,    // 따로 넣은 그림 { name, picture } — 있으면 도트화 탭 대신 이 그림을 보낸다
    result: null,   // { ai, final, pixel, status }
  },
};
const $ = id => document.getElementById(id);

// ───────────── 작업자와 일 순서
// 일은 하나씩 보낸다. 기다리는 일 중 새 일이 덮어쓰는 것(같은 종류의 다시 그리기 등)은 버려서 마지막 설정만 계산한다.
const engine = (() => {
  const code = document.querySelector('script[data-app]').textContent;
  const shared = code.slice(code.indexOf('/*SHARED-START*/'), code.indexOf('/*SHARED-END*/'));
  const source = shared + '\n' + $('worker-src').textContent;
  let worker;
  try {
    worker = new Worker(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })));
  } catch (error) {
    console.error(error);
  }
  let running = null, waiting = [], nextId = 1;
  const pump = () => {
    if (running || waiting.length === 0) return;
    running = waiting.shift();
    state.busy = running.label;
    state.error = null;
    update();
    worker.postMessage({ id: running.id, type: running.type, ...running.payload });
  };
  const done = () => { running = null; if (waiting.length === 0) state.busy = null; pump(); update(); };
  if (worker) {
    worker.onmessage = ({ data }) => {
      if (!running || data.id !== running.id) return;
      if (data.type === 'progress') { state.busy = data.label; updateStatus(); return; }
      if (data.type === 'error') { state.error = data.message; running.fail?.(data.message, data); }
      else running.apply(data);
      done();
    };
    worker.onerror = event => {
      event.preventDefault();
      state.error = `${Errors.render} (${event.message})`;
      waiting = [];
      if (running) done(); else update();
    };
  }
  return {
    submit(type, payload, label, apply, fail) {
      if (!worker) { state.error = '이 브라우저에서 작업자를 시작하지 못했습니다. 크롬·엣지 최신 버전으로 열어 주세요.'; update(); fail?.(state.error); return; }
      const drops = { open: ['open', 'resize', 'redot'], resize: ['resize', 'redot'], redot: ['redot'] }[type] ?? [];
      waiting = waiting.filter(job => !drops.includes(job.type));
      waiting.push({ id: nextId++, type, payload, label, apply, fail });
      if (running) { state.busy = label; updateStatus(); }
      pump();
    },
    /** 결과를 기다릴 수 있는 요청(실패하면 오류 문구로 거부) */
    request(type, payload, label) {
      return new Promise((resolve, reject) => this.submit(type, payload, label, resolve, message => reject(new Error(message))));
    },
  };
})();

// ───────────── 이미지 읽기·저장
async function decode(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { premultiplyAlpha: 'none', colorSpaceConversion: 'default' });
  } catch {
    throw new DotError(Errors.read);
  }
  const { width: w, height: h } = bitmap;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0);
  const straight = context.getImageData(0, 0, w, h).data;
  bitmap.close();
  // 맥 CGImage처럼 프리멀티플라이 바이트로 바꾼다.
  const data = new Uint8Array(straight.length);
  for (let i = 0; i < straight.length; i += 4) {
    const a = straight[i + 3];
    data[i] = Math.floor((straight[i] * a + 127) / 255);
    data[i + 1] = Math.floor((straight[i + 1] * a + 127) / 255);
    data[i + 2] = Math.floor((straight[i + 2] * a + 127) / 255);
    data[i + 3] = a;
  }
  return limitSize({ w, h, data });
}

function toCanvas(picture) {
  const canvas = document.createElement('canvas');
  canvas.width = picture.w;
  canvas.height = picture.h;
  canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(picture.bytes), picture.w, picture.h), 0, 0);
  return canvas;
}

/** 정수배 확대: 한 픽셀을 k×k 칸으로 그대로 늘린다(번짐 없음). */
function scaled(picture, k) {
  if (k <= 1) return picture;
  const w = picture.w * k, h = picture.h * k, src = new Uint32Array(picture.bytes.buffer.slice(0)), out = new Uint32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = src[((y / k) | 0) * picture.w + ((x / k) | 0)];
  return { w, h, bytes: new Uint8ClampedArray(out.buffer) };
}

async function writePNG(picture, suggestedName) {
  const blob = await new Promise(done => toCanvas(picture).toBlob(done, 'image/png'));
  if (window.showSaveFilePicker) {
    let handle;
    try {
      handle = await window.showSaveFilePicker({
        id: 'dotmaker-save', suggestedName,
        types: [{ description: 'PNG 이미지', accept: { 'image/png': ['.png'] } }],
      });
    } catch (error) {
      if (error.name === 'AbortError') return;
      handle = null;
    }
    if (handle) {
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    }
  }
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = suggestedName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 10000);
}

// ───────────── 동작
function dimensions() {
  const ok = v => /^\d+$/.test(v) && Number(v) >= 16 && Number(v) <= 512;
  if (!ok(state.width) || !ok(state.height)) {
    state.error = Errors.dimensions;
    update();
    return null;
  }
  return [Number(state.width), Number(state.height)];
}

let submittedSettings = null;
const applyProduct = data => { state.product = { reduced: data.reduced, dotted: data.dotted, status: data.status }; };

// 새 버전 알림: 깃허브의 최신 릴리스가 지금 버전보다 높으면 위쪽에 받기 링크를 보여 준다(실패하면 조용히 넘어감).
async function checkUpdate() {
  try {
    const reply = await fetch(`https://api.github.com/repos/${SETTINGS.repository}/releases/latest`, { signal: AbortSignal.timeout(8000) });
    if (!reply.ok) return;
    const latest = String((await reply.json()).tag_name || '').replace(/^v/, '');
    const parts = v => v.split('.').map(Number);
    const [a, b] = [parts(latest), parts(VERSION)];
    if (a.length !== 3 || a.some(Number.isNaN)) return;
    const newer = a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2];
    if (!newer) return;
    $('version').after(el('a', { className: 'update', href: `https://github.com/${SETTINGS.repository}/releases/latest`, target: '_blank', rel: 'noopener', textContent: `새 버전 ${latest} 받기` }));
  } catch { /* 인터넷이 없거나 깃허브가 응답하지 않으면 알림 없이 넘어간다 */ }
}

function applyOpened(data, original, name) {
  applyProduct(data);
  state.jevApplied = false;
  state.original = { w: original.w, h: original.h, bytes: Raster.fromPremultiplied(original.data, original.w, original.h).straightBytes() };
  state.fileName = name;
  state.cloud.result = null;
  state.lab.result = null;
  state.aligned = null;
  state.compare = false;
  if (state.stage !== 'help') state.stage = 'dot';
}

/** 한 장이면 열고, 여러 장이면 지금 설정으로 모두 도트화해 고른 폴더에 저장한다. */
function openFiles(files) {
  const images = files.filter(f => f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(f.name));
  if (images.length > 1) batch(images); else open(images[0]);
}

async function batch(files) {
  const size = dimensions();
  if (!size || state.busy) return;
  const folder = await desktop?.pickFolder?.();
  if (!folder) return;
  const settings = { ...state.settings }, scale = state.exportScale, failed = [];
  let saved = 0;
  state.notice = null;
  for (const [k, file] of files.entries()) {
    const label = `여러 장 도트화 중 (${k + 1}/${files.length}) · ${file.name}`;
    try {
      state.busy = label; state.error = null; update();
      const original = await decode(file);
      submittedSettings = settings;
      const data = await engine.request('open', { original, w: size[0], h: size[1], settings }, label);
      applyOpened(data, original, file.name);
      const picture = scaled(data.dotted, scale);
      const blob = await new Promise(done => toCanvas(picture).toBlob(done, 'image/png'));
      await desktop.writeToFolder(outputName(file.name, 'dot', data.dotted, scale), new Uint8Array(await blob.arrayBuffer()));
      saved++;
    } catch (error) {
      console.error(error);
      failed.push(file.name);
    }
  }
  state.busy = null;
  state.error = null;
  state.notice = `여러 장 도트화: ${saved}장을 '${folder}' 폴더에 저장했습니다` + (failed.length ? ` · 실패 ${failed.length}장 (${failed.join(', ')})` : '');
  update();
}

/** whole: 캐릭터 분리(배경 지우기)를 건너뛰고 그림 전체를 그대로 변환한다. */
async function open(file, whole = false) {
  if (!file) return;
  const size = dimensions();
  if (!size) return;
  state.notice = null;
  state.retryWhole = null;
  state.busy = '이미지 읽는 중';
  state.error = null;
  update();
  let original;
  try {
    original = await decode(file);
  } catch (error) {
    state.busy = null;
    state.error = error.message;
    update();
    return;
  }
  const settings = { ...state.settings };
  submittedSettings = settings;
  engine.submit('open', { original, w: size[0], h: size[1], settings, whole }, whole ? '그림 전체를 그대로 변환 중' : '원본에서 캐릭터 분리 중',
    data => applyOpened(data, original, file.name),
    // 캐릭터 분리에 실패하면 그냥 끝내지 않고, 분리 없이 그대로 변환할지 고르게 한다.
    (message, data) => { if (data?.canSkip) state.retryWhole = file; });
}

function resize() {
  const size = dimensions();
  if (!state.product || !size) return;
  const settings = { ...state.settings };
  submittedSettings = settings;
  engine.submit('resize', { w: size[0], h: size[1], settings }, '캐릭터 축소 중', data => { applyProduct(data); state.aligned = null; if (state.compare) loadAligned(); });
}

function redot() {
  if (!state.product || JSON.stringify(submittedSettings) === JSON.stringify(state.settings)) return;
  const settings = { ...state.settings };
  const label = settings.aiLines && settings.method !== 'soft' && !submittedSettings.aiLines ? '선 추출 AI가 원본의 선을 읽는 중' : '외곽선 정리 중';
  submittedSettings = settings;
  engine.submit('redot', { settings }, label, applyProduct);
}

function result(stage = state.stage) {
  if (stage === 'lab') return state.lab.result;
  if (stage === 'repair' && !state.product) return state.cloud.result?.final ?? null;
  if (!state.product) return null;
  if (stage === 'reduce') return state.product.reduced;
  if (stage === 'dot') return state.product.dotted;
  if (stage === 'repair') return state.cloud.result?.final ?? null;
  return null;
}

// ───────────── AI 보정(클라우드)
/** PixelLab 다듬기: 지금 도트화 결과를 크기 그대로 보내 정리받는다. */
async function runCorrect(key) {
  const before = state.cloud.input?.picture ?? state.product.dotted, strength = state.cloud.fix;
  if (before.w * before.h > 1024 * 1024) { state.error = 'PixelLab 다듬기는 1024×1024 넓이까지입니다. 더 작은 도트 그림을 넣어 주세요.'; update(); return; }
  if (!confirm(`${state.cloud.input ? `넣은 그림 '${state.cloud.input.name}'` : '지금 도트화 결과'}(${before.w}×${before.h})를 PixelLab(api.pixellab.ai)로 보내 다듬기를 합니다.\n요금: PixelLab이 정하며 결과에 표시됩니다 (내 API 키 계정에 청구)\n\n계속할까요?`)) return;
  state.cloud.result = null;
  state.busy = `PixelLab이 다듬는 중 (강도 ${strength.toFixed(2)})`;
  state.error = null;
  update();
  try {
    const corrected = await cloudCorrect(key, before, strength);
    const image = await decode(corrected.blob);
    const final = { w: image.w, h: image.h, bytes: Raster.fromPremultiplied(image.data, image.w, image.h).straightBytes() };
    const cost = corrected.cost !== null && corrected.cost !== undefined ? ` · 이번 요금 $${Number(corrected.cost).toFixed(4)}` : '';
    state.cloud.result = { ai: before, final, pixel: true, corrected: true, status: `PixelLab 다듬기 · 강도 ${strength.toFixed(2)} · ${final.w}×${final.h}${cost}` };
  } catch (error) {
    state.error = error instanceof CloudError ? error.message : `다듬기를 하지 못했습니다. (${error.message})`;
  }
  state.busy = null;
  update();
}

function setCloud(key, value) {
  state.cloud[key] = value;
  if (['provider', 'faithful', 'strength', 'quality', 'mode', 'fix'].includes(key)) store.set('cloud.' + key, value);
  update();
}

const correcting = () => state.cloud.provider === 'pixellab' && state.cloud.mode === 'correct';

async function runCloud() {
  const id = state.cloud.provider, info = CLOUD[id], key = cloudKey.get(id), input = state.cloud.input;
  if (!(state.product || input) || !key || state.busy) return;
  if (correcting()) return runCorrect(key);
  const size = state.product ? [state.product.dotted.w, state.product.dotted.h] : dimensions();
  if (!size) return;
  if (!confirm(`${input ? `넣은 그림 '${input.name}'` : '캐릭터 그림'}을(를) ${info.name}(${info.host})로 보내 AI 보정을 합니다.\n요금: 1장 ${info.price} (내 API 키 계정에 청구)\n\n계속할까요?`)) return;
  state.cloud.result = null;
  try {
    const subject = input ? input.picture : (await engine.request('subject', {}, `${info.name}에 보낼 그림 준비 중`)).subject;
    state.busy = `${info.name}가 그리는 중 (보통 몇 초~1분)`;
    state.error = null;
    update();
    const painted = await cloudPaint(id, key, subject, size, state.cloud);
    const image = await decode(painted.blob);
    const ai = { w: image.w, h: image.h, bytes: Raster.fromPremultiplied(image.data, image.w, image.h).straightBytes() };
    state.busy = null;
    const done = await engine.request('cloud', { image, w: size[0], h: size[1], settings: { ...state.settings }, pixel: painted.pixel },
      painted.pixel ? 'AI 도트 그림 배경 지우는 중' : 'AI 그림을 도트화하는 중');
    const cost = painted.cost !== null && painted.cost !== undefined ? ` · 이번 요금 $${Number(painted.cost).toFixed(4)}` : '';
    state.cloud.result = { ai, final: done.final, pixel: painted.pixel, status: `${info.name} · ${done.status}${cost}` };
  } catch (error) {
    state.busy = null;
    state.error = error instanceof CloudError ? error.message : `AI 보정을 하지 못했습니다. (${error.message})`;
  }
  update();
}

function outputName(fileName, stage, picture, scale) {
  const base = fileName ? fileName.replace(/\.[^.]+$/, '') : '도트그림';
  return `${base}-${STAGES[stage].name}-${picture.w}x${picture.h}${scale > 1 ? `-${scale}배` : ''}.png`;
}

/** 지금 탭의 결과를 저장 배율대로 클립보드에 복사한다. */
async function copyResult() {
  const picture = result();
  if (!picture || state.busy) return;
  try {
    const blob = await new Promise(done => toCanvas(scaled(picture, state.exportScale)).toBlob(done, 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    state.notice = `결과를 복사했습니다 (${picture.w * state.exportScale}×${picture.h * state.exportScale})`;
  } catch (error) {
    console.error(error);
    state.error = '결과를 복사하지 못했습니다.';
  }
  update();
}

/** 비교용 원본: 캐릭터를 결과와 같은 자리·크기로 놓은 그림(reduceDirect와 같은 배치). */
async function loadAligned() {
  if (state.aligned || !state.product) return;
  const { w, h } = state.product.dotted;
  try {
    const { subject } = await engine.request('subject', {}, '비교할 원본 준비 중');
    const scale = Math.min((w - 4) / subject.w, (h - 4) / subject.h);
    const sw = Math.max(1, Math.round(subject.w * scale)), sh = Math.max(1, Math.round(subject.h * scale));
    const k = Math.max(1, Math.round(1200 / Math.max(w, h)));
    const canvas = document.createElement('canvas');
    canvas.width = w * k; canvas.height = h * k;
    const context = canvas.getContext('2d');
    context.imageSmoothingQuality = 'high';
    context.drawImage(toCanvas(subject), Math.trunc((w - sw) / 2) * k, Math.trunc((h - sh) / 2) * k, sw * k, sh * k);
    state.aligned = { w: canvas.width, h: canvas.height, bytes: context.getImageData(0, 0, canvas.width, canvas.height).data };
  } catch (error) {
    console.error(error);
    state.compare = false;
  }
  update();
}

function toggleCompare() {
  state.compare = !state.compare;
  update();
  if (state.compare) loadAligned();
}

function save() {
  const picture = result();
  if (!picture || state.busy) return;
  const scale = state.exportScale;
  const name = outputName(state.fileName, state.stage, picture, scale);
  writePNG(scaled(picture, scale), name).catch(error => { state.error = 'PNG를 저장하지 못했습니다.'; console.error(error); update(); });
}

function setSetting(key, value) {
  state.settings = { ...state.settings, [key]: value };
  store.set('settings', state.settings);
  state.notice = null;
  state.jevApplied = false;
  update();
  redot();
}

// ───────────── AI 파일(설명서 탭)
async function refreshAIFiles() {
  state.aiFiles = await fileStore.keys();
  if (state.stage === 'help') update();
}

async function importAIFiles(files) {
  const saved = [], unknown = [];
  state.aiMessage = 'AI 파일 넣는 중…';
  update();
  for (const file of files) {
    const id = identifyAIFile(file.size);
    if (!id) { unknown.push(file.name); continue; }
    try {
      await fileStore.put(id, new Uint8Array(await file.arrayBuffer()));
      saved.push(AI_FILES[id].name);
    } catch (error) {
      console.error(error);
      unknown.push(`${file.name}(저장 실패)`);
    }
  }
  state.aiMessage = [saved.length ? `넣었습니다: ${saved.join(', ')}` : '',
    unknown.length ? `알 수 없는 파일이라 건너뛰었습니다: ${unknown.join(', ')} — 아래 표의 파일을 그대로(크기가 같게) 받아 주세요.` : ''].filter(Boolean).join(' / ');
  await refreshAIFiles();
}

async function clearAIFiles() {
  if (!confirm('저장된 AI 파일을 모두 지울까요? 다시 쓰려면 다시 받아야 합니다.')) return;
  await fileStore.clear().catch(() => {});
  state.aiMessage = '저장된 AI 파일을 지웠습니다. 열려 있는 AI는 페이지를 새로 고치면 완전히 지워집니다.';
  await refreshAIFiles();
}

// ───────────── 화면 조각
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter(c => c !== null && c !== undefined && c !== false));
  return node;
};

function preview(title, picture, pixelated, action = null) {
  const head = el('header', {}, el('h3', { textContent: title }), action,
    picture && el('span', { className: 'size', textContent: `${picture.w} × ${picture.h} px` }));
  const frame = el('div', { className: 'frame' });
  if (picture) {
    const canvas = toCanvas(picture);
    canvas.className = pixelated ? 'pixelated' : '';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', title);
    frame.append(canvas);
  }
  return el('section', { className: 'preview' }, head, frame);
}

function segmented(options, value, onPick, disabled = false, label = '') {
  const group = el('div', { className: 'segmented' });
  group.setAttribute('role', 'radiogroup');
  if (label) group.setAttribute('aria-label', label);
  for (const [optionValue, text] of options) {
    const button = el('button', { type: 'button', textContent: text, disabled });
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-checked', String(optionValue === value));
    button.onclick = () => { if (optionValue !== value) onPick(optionValue); };
    group.append(button);
  }
  return group;
}

function stepper(text, value, min, max, step, onChange, disabled = false) {
  const minus = el('button', { type: 'button', textContent: '−', disabled: disabled || value <= min, onclick: () => onChange(Math.max(min, value - step)) });
  const plus = el('button', { type: 'button', textContent: '+', disabled: disabled || value >= max, onclick: () => onChange(Math.min(max, value + step)) });
  minus.setAttribute('aria-label', '줄이기');
  plus.setAttribute('aria-label', '늘리기');
  return el('div', { className: 'stepper' + (disabled ? ' disabled' : '') }, el('span', { textContent: text }), minus, plus);
}

const labelled = (text, control) => el('label', { className: 'field' }, el('span', { textContent: text }), control);

/** AI 업스케일(ESRGAN): 도트화 전에 원본을 4배로 키운다. 도트화·AI 보정 탭이 같은 설정을 쓴다. */
function upscaleControl() {
  const control = labelled('AI 업스케일', segmented([['auto', '자동'], ['strong', '6B'], ['light', 'v3'], ['off', '끄기']],
    state.settings.upscale, v => setSetting('upscale', v), false, 'AI 업스케일'));
  control.title = '도트화하기 전에 원본을 AI(Real-ESRGAN)로 4배 키워 흐린 선과 잡티를 정리합니다. 자동은 원본이 결과 크기의 4배보다 작을 때만 켭니다. 6B는 더 깔끔하고, v3는 더 빠릅니다.';
  return control;
}
const row = (...children) => el('div', { className: 'row' }, ...children);

function toggle(text, checked, onChange, disabled, title = '') {
  const input = el('input', { type: 'checkbox', checked, disabled, onchange: () => onChange(input.checked) });
  return el('label', { className: 'toggle', title }, input, document.createTextNode(text));
}

function sizeChoices() {
  const { min, max, step } = SETTINGS.size, choices = [];
  for (let v = min; v <= max; v += step) choices.push(v);
  return choices;
}

/** 결과 크기(정사각형, 범위는 settings.js). 고르면 바로 다시 그린다. 도트화·AI 보정 탭이 같은 크기를 쓴다. */
function sizeControl(off = false) {
  const select = el('select', { disabled: off || Boolean(state.busy), onchange: event => { state.width = state.height = event.target.value; store.set('size', Number(event.target.value)); state.notice = null; resize(); } },
    ...sizeChoices().map(v => el('option', { value: String(v), textContent: `${v}×${v}`, selected: String(v) === state.width })));
  select.setAttribute('aria-label', '결과 크기');
  return labelled('결과 크기', select);
}

/** 모든 도트화 방식 공통 마무리 설정. */
function finishRow(off) {
  const s = state.settings;
  const palette = el('select', { disabled: off, onchange: event => setSetting('palette', event.target.value) },
    ...[['off', '끄기'], ...Object.entries(PALETTES).map(([id, p]) => [id, p.name]), ['custom', '직접 입력']]
      .map(([value, textContent]) => el('option', { value, textContent, selected: value === s.palette })));
  palette.setAttribute('aria-label', '팔레트 고정');
  const custom = s.palette === 'custom' && el('input', { type: 'text', className: 'palette', value: s.paletteCustom, disabled: off, spellcheck: false,
    placeholder: '예: #1a1c2c, #f4f4f4, ff77a8', onchange: event => setSetting('paletteCustom', event.target.value) });
  if (custom) custom.setAttribute('aria-label', '팔레트 색');
  return row(
    toggle('가장자리 반투명 없애기', s.hardEdge, v => setSetting('hardEdge', v), off,
      '테두리의 반투명 칸을 절반 이상 덮였으면 불투명, 아니면 투명으로 딱 자릅니다. 색 배경 위에 올려도 테두리가 흐리지 않습니다.'),
    toggle('외톨이 점 정리', s.lonePixels, v => setSetting('lonePixels', v), off,
      '둘레 어느 칸과도 색이 크게 다른 한 칸짜리 점을 둘레 색으로 바꿉니다. 선과 눈 하이라이트는 두지만, 작은 장식 점이 사라질 수 있습니다.'),
    labelled('팔레트 고정', palette), custom);
}

function controls(stage) {
  if (stage === 'repair') return cloudControls();
  if (stage === 'lab') return labControls();
  const loaded = Boolean(state.product);
  const sizeRow = row(sizeControl(), upscaleControl());
  if (stage === 'dot') {
    // 설정은 계산 중에도 바꿀 수 있다(마지막 설정으로 다시 계산).
    const s = state.settings, off = !loaded, soft = s.method === 'soft';
    const methods = segmented([['faithful', '원본 보존'], ['soft', '원본 색 살림'], ['berry', '베리 잉크'], ['basic', '2.0 방식'], ['direct', '원본 직행']], s.method, v => setSetting('method', v), off, '도트화 방식');
    if (s.method === 'faithful') {
      return el('div', { className: 'stack' }, sizeRow, row(methods),
        row(toggle('또렷하게(작은 크기용)', s.sharpCells, v => setSetting('sharpCells', v), off,
          '칸 색을 평균 내지 않고 선 색이나 면 색 하나로 고릅니다. 작은 결과 크기에서 눈·입·무늬가 회색으로 뭉개지는 것을 줄입니다. 큰 크기에서는 선이 거칠어질 수 있습니다.'),
        toggle('바깥 외곽선 1픽셀(원본 선 색)', s.crispOutline, v => setSetting('crispOutline', v), off,
          '투명 배경 바로 앞 가장 바깥 칸만, 원본 그 자리에 선이 있으면 원본 선 색으로 칠하고 그 바깥의 흐린 칸을 지웁니다. 흰 외곽선 장식과 바닥 그림자는 그대로 둡니다.'),
        toggle('원본 색 맞추기', s.snapColors, v => setSetting('snapColors', v), off,
          '축소하면서 생긴 탁한 중간색 대신, 그 칸 원본에 실제로 있는 가장 가까운 색을 넣습니다.'),
        toggle('경계 섞인 색 정리', s.cleanBlends, v => setSetting('cleanBlends', v), off,
          '축소하면서 경계에 생긴 탁한 중간색(빨강+검정 → 자주 등)을 가까운 원래 색으로 바꿉니다. 부드러운 명암은 건드리지 않습니다.'),
        toggle('작은 입선 보존', s.preserveMouth, v => setSetting('preserveMouth', v), off,
          '눈 두 개 사이 아래의 작은 입 선(ω 등)이 회색으로 뭉개지지 않게 원본 선 색으로 살립니다.')),
        finishRow(off), jevControls());
    }
    // 원본 색 살림은 원본 선을 그대로 살리는 방식이라 외곽선·선 추출·경계색을 쓰지 않는다.
    const colorStepper = soft
      ? stepper(`최대 ${s.softColors}색`, s.softColors, 4, 64, 2, v => setSetting('softColors', v), off)
      : stepper(`최대 ${s.colors}색`, s.colors, 6, 32, 1, v => setSetting('colors', v), off);
    return el('div', { className: 'stack' }, sizeRow,
      row(methods),
      soft && row(toggle('선 1픽셀로 정리', s.softLines, v => setSetting('softLines', v), off,
        '큰 원본에서 선의 가운데 줄기를 찾아 그 줄기가 지나는 칸만 선으로 칠합니다. 선이 끊기거나 뭉치지 않고 입(ω) 같은 작은 모양이 살아납니다. 원본이 굵은 선 그림이면 꺼 보세요.'),
        toggle('선명하게', s.softVivid, v => setSetting('softVivid', v), off,
          '분홍·보라 같은 색의 채도를 25% 올려 또렷하게 합니다. 흰색·검정·회색은 그대로입니다.'),
        toggle('테두리·색 면 정리', s.softClean, v => setSetting('softClean', v), off,
          '바깥 테두리를 끊김 없는 순검정 1px로 잇고, 거의 같은 색을 합치고 혼자 떨어진 점을 지웁니다.'),
        toggle('강조색 지키기', s.keepAccents, v => setSetting('keepAccents', v), off,
          '면적이 작아 색 줄이기에서 빠진 또렷한 색(눈 하이라이트·작은 장식)을 최대 3색까지 더 남깁니다.')),
      row(colorStepper,
        labelled('색 정리', segmented([[0, '끄기'], [1, '보통'], [2, '강하게']], s.cleanup, v => setSetting('cleanup', v), off || (s.method !== 'basic' && s.method !== 'direct'), '색 정리'))),
      row(labelled('검은 외곽선', segmented([[1, '1줄'], [2, '2줄']], s.width, v => setSetting('width', v), off || soft, '검은 외곽선'))),
      row(toggle('선 추출 AI로 빠진 선 채우기', s.aiLines, v => setSetting('aiLines', v), off || soft,
        'MangaLineExtraction으로 원본의 구조선을 읽어, 도트에서 끊기거나 빠진 안쪽 선만 채웁니다. 처음 한 번 모델(약 82MB)을 받습니다.')),
      row(toggle('몸통 경계색', s.boundary, v => setSetting('boundary', v), off || soft),
        stepper(`투명도 ${s.transparency}%`, s.transparency, 0, 100, 5, v => setSetting('transparency', v), off || soft || !s.boundary)),
      soft && el('p', { className: 'note', textContent: '원본 색 살림: 원본의 색을 살리고 색 수만 줄입니다. 외곽선·선 추출·경계색은 베리 잉크·2.0 방식·원본 직행에서 씁니다.' }),
      finishRow(off),
      jevAutoControls(),
    );
  }
  return null;
}

/** API 키 줄: 저장돼 있으면 끝 4자리와 바꾸기·지우기, 없으면 입력칸. AI 보정 탭이 쓴다. */
function keyRow(id) {
  const c = state.cloud, info = CLOUD[id], key = cloudKey.get(id);
  if (key && c.editingKey !== id) {
    return row(el('span', { textContent: `${info.name} API 키 저장됨 (…${key.slice(-4)})` }),
      el('button', { type: 'button', textContent: '키 바꾸기', onclick: () => setCloud('editingKey', id) }),
      el('button', { type: 'button', textContent: '키 지우기', onclick: () => { cloudKey.clear(id); update(); } }));
  }
  const input = el('input', { type: 'password', placeholder: info.keyHint, autocomplete: 'off', spellcheck: false, className: 'key' });
  input.setAttribute('aria-label', `${info.name} API 키`);
  const saveKey = () => {
    const value = input.value.trim();
    if (!value) return;
    cloudKey.set(id, value);
    c.editingKey = false;
    update();
  };
  input.onkeydown = event => { if (event.key === 'Enter') saveKey(); };
  return row(input, el('button', { type: 'button', textContent: '키 저장', onclick: saveKey }),
    c.editingKey === id && el('button', { type: 'button', textContent: '취소', onclick: () => setCloud('editingKey', false) }),
    el('a', { href: info.keyPage, target: '_blank', rel: 'noopener', textContent: '키 발급 페이지 ↗' }));
}

async function loadPictureFile(file) {
  const image = await decode(file);
  return { w: image.w, h: image.h, bytes: Raster.fromPremultiplied(image.data, image.w, image.h).straightBytes() };
}
function pickFile(onPicture) {
  const input = el('input', { type: 'file', accept: 'image/*' });
  input.onchange = async () => {
    const file = input.files[0];
    try { if (file) onPicture(await loadPictureFile(file), file.name); }
    catch (error) { state.error = error.message; update(); }
  };
  input.click();
}

/** AI 보정에 보낼 그림: 도트화 탭 이미지(다시 그리기는 캐릭터 원본, 다듬기는 도트화 결과) 또는 따로 넣은 그림 */
function setCloudInput(picture, name) {
  state.cloud.input = picture ? { picture, name } : null;
  state.cloud.result = null;
  update();
}
function inputRow() {
  const c = state.cloud, busy = Boolean(state.busy);
  return row(el('span', { textContent: '보낼 그림:' }),
    el('span', { className: 'muted', textContent: c.input ? `넣은 그림 '${c.input.name}' (${c.input.picture.w}×${c.input.picture.h})`
      : state.product ? (correcting() ? '지금 도트화 결과' : '도트화 탭에서 연 이미지의 캐릭터') : '없음 — 이미지를 넣거나 열어 주세요' }),
    el('button', { type: 'button', textContent: '다른 이미지 넣기…', disabled: busy, onclick: () => pickFile((picture, name) => setCloudInput(picture, name)) }),
    c.input && el('button', { type: 'button', textContent: '넣은 그림 빼기', disabled: busy, onclick: () => setCloudInput(null) }),
    el('span', { className: 'note', textContent: '이 탭에 이미지를 끌어다 놓아도 됩니다' }));
}

function cloudControls() {
  const c = state.cloud, info = CLOUD[c.provider], key = cloudKey.get(c.provider), busy = Boolean(state.busy);
  const options = c.provider === 'pixellab'
    ? el('div', { className: 'stack' },
      row(segmented([['redraw', '다시 그리기'], ['correct', '다듬기']], c.mode, v => setCloud('mode', v), busy, 'PixelLab 방식'),
        el('span', { className: 'muted', textContent: c.mode === 'correct'
          ? '지금 도트화 결과를 크기 그대로 보내 잔점·계단 가장자리·색을 정리합니다'
          : '캐릭터 원본을 보내 지금 크기의 도트 그림으로 새로 그립니다' })),
      c.mode === 'correct'
        ? row(stepper(`다듬기 강도 ${c.fix.toFixed(2)}`, c.fix, 0, 1, 0.05, v => setCloud('fix', Math.round(v * 100) / 100), busy),
          el('span', { className: 'note', textContent: '낮을수록 잔점·가장자리만, 높을수록 많이 고쳐 그립니다(권장 0.1부터)' }))
        : row(toggle('원본에 충실하게', c.faithful, v => setCloud('faithful', v), busy, 'PixelLab의 충실 모드(fixer). 끄면 AI가 도트 그림으로 새로 해석합니다.'),
          stepper(`원본 유지 ${c.strength}`, c.strength, 0, 600, 50, v => setCloud('strength', v), busy)))
    : c.provider === 'openai'
      ? row(labelled('품질', segmented([['low', '낮음(싸고 빠름)'], ['medium', '보통']], c.quality, v => setCloud('quality', v), busy, '품질')))
      : null;
  return el('div', { className: 'stack' },
    row(segmented(Object.entries(CLOUD).map(([id, v]) => [id, v.name]), c.provider, v => { c.editingKey = false; setCloud('provider', v); }, busy, 'AI 서비스'),
      el('span', { className: 'muted', textContent: info.detail })),
    keyRow(c.provider),
    options,
    // 다듬기에 따로 넣은 그림은 크기 그대로 보내므로 결과 크기를 쓰지 않는다.
    row(sizeControl(correcting() && Boolean(c.input)), upscaleControl(), el('span', { className: 'note', textContent: '다시 그린 그림을 도트화하기 전에 적용됩니다(받은 그림이 이미 도트 그림이면 쓰지 않음)' })),
    inputRow(),
    row(el('button', { type: 'button', className: 'primary', textContent: 'AI 보정 실행', disabled: busy || !(state.product || c.input) || !key, onclick: runCloud }),
      el('span', { className: 'note', textContent: correcting()
        ? `실행하면 보낼 그림이 ${info.host}로 전송되고 요금이 듭니다(결과에 표시, 내 키 계정에 청구). 키는 이 프로그램에만 저장됩니다.`
        : `실행하면 보낼 그림이 ${info.host}로 전송되고 1장에 ${info.price} 요금이 듭니다(내 키 계정에 청구). 키는 이 프로그램에만 저장됩니다.` })),
  );
}

function statusLine(stage) {
  const status = el('p', { className: 'status' });
  status.setAttribute('aria-live', 'polite');
  if (state.busy) {
    status.append(el('span', { className: 'spinner' }), document.createTextNode(state.busy));
    status.firstChild.setAttribute('aria-hidden', 'true');
  } else if (state.error) {
    status.classList.add('error');
    status.textContent = state.error;
    if (state.retryWhole) {
      const file = state.retryWhole;
      status.append(el('button', { type: 'button', className: 'retry', textContent: '분리 없이 그대로 변환', onclick: () => open(file, true),
        title: '배경을 지우지 않고 그림 전체를 그대로 도트로 바꿉니다.' }));
    }
  } else if (state.notice) {
    status.textContent = state.notice;
  } else if (stage === 'dot' && state.product) {
    status.textContent = state.product.status;
  } else if (stage === 'repair' && state.cloud.result) {
    status.textContent = state.cloud.result.status;
  } else if (stage === 'lab' && state.lab.result) {
    status.textContent = state.lab.status;
  }
  return status;
}

function screen(stage) {
  if (stage === 'help') return helpScreen();
  const instruction = stage === 'dot' && state.settings.method === 'faithful'
    ? '원본 한 장을 열면 선 굵기와 명암을 살려 투명 PNG 크기에 맞춥니다. 원본에서 바로 격자 칸마다 색을 읽습니다.'
    : stage === 'dot' && state.settings.method === 'soft'
    ? '원본의 색을 살리고 색 수만 줄여 도트로 바꿉니다. 선은 원본에서 줄기를 찾아 1픽셀로 정리하고, 색은 조금 더 선명하게, 바깥 테두리와 색 면은 깔끔하게 정리합니다.'
    : STAGES[stage].instruction;
  const page = el('div', { className: 'screen' }, el('p', { className: 'muted', textContent: instruction }), controls(stage));
  if (stage === 'lab' && labSource()) {
    page.append(el('div', { className: 'previews' }, preview('원본', labSource(), false), preview('결과', state.lab.result, true)));
  } else if (stage === 'repair' && (state.product || state.cloud.input)) {
    const r = state.cloud.result, input = state.cloud.input;
    page.append(el('div', { className: 'previews' },
      r ? preview(r.corrected ? '다듬기 전' : r.pixel ? 'AI 도트 그림' : 'AI가 그린 그림', r.ai, r.pixel)
        : preview(input ? `보낼 그림 · ${input.name}` : '보낼 그림 · 지금 도트화 결과', input ? input.picture : result('dot'), true),
      preview('결과', r?.final ?? null, true)));
  } else if (state.product && state.original) {
    // 원본 보기: 결과 자리에 원본 캐릭터를 같은 위치·크기로 보여 줘, 눌러 가며 달라진 곳을 본다.
    const showing = state.compare && state.aligned;
    const compare = el('button', { type: 'button', className: 'compare', textContent: showing ? '결과 보기' : '원본 보기', onclick: toggleCompare,
      title: '결과 자리에 원본을 같은 위치·크기로 보여 줍니다. 눌러 가며 달라진 곳을 비교하세요.' });
    compare.setAttribute('aria-pressed', String(Boolean(showing)));
    const after = showing ? preview('원본 (결과와 같은 자리)', state.aligned, false, compare) : preview('결과', result('dot'), true, compare);
    if (showing) after.querySelector('.size').textContent = `${result('dot').w} × ${result('dot').h} px 자리`;
    page.append(state.settings.method === 'faithful'
        ? el('div', { className: 'previews' }, preview('원본', state.original, false), after)
        : el('div', { className: 'previews' }, preview('축소 이미지', result('reduce'), true), after));
  } else {
    page.append(el('button', { type: 'button', className: 'empty drop', onclick: () => $('file').click() },
      el('strong', { textContent: '캐릭터 이미지를 여기에 놓으십시오' }), el('span', { textContent: 'PNG, JPEG, WebP 등 이미지 파일 · 눌러서 고를 수도 있어요' })));
  }
  page.append(statusLine(stage));
  if (state.jev) page.append(jevSheet());
  return page;
}

// ───────────── 설명서
function helpScreen() {
  if (state.aiFiles === null) refreshAIFiles();
  const stored = new Set(state.aiFiles ?? []);
  const mb = n => `${(n / 1048576).toFixed(n < 1048576 ? 2 : 0)}MB`;
  const table = el('table', { className: 'files' },
    el('thead', {}, el('tr', {}, ...['상태', '파일 이름', '크기', '용도', '받는 주소'].map(t => el('th', { textContent: t })))),
    el('tbody', {}, ...Object.entries(AI_FILES).map(([id, f]) => el('tr', {},
      el('td', { className: stored.has(id) ? 'ok' : 'missing', textContent: state.aiFiles === null ? '확인 중' : stored.has(id) ? '저장됨' : '없음' }),
      el('td', {}, el('code', { textContent: f.name }), el('div', { className: 'muted', textContent: f.title })),
      el('td', { className: 'num', textContent: mb(f.size) }),
      el('td', { textContent: f.use }),
      el('td', { className: 'url' }, el('a', { href: f.url, textContent: f.url, target: '_blank', rel: 'noopener' }))))));
  const picker = el('input', { type: 'file', multiple: true, hidden: true, onchange: () => { importAIFiles([...picker.files]); picker.value = ''; } });
  const actions = row(
    el('button', { type: 'button', className: 'primary', textContent: 'AI 파일 불러오기…', onclick: () => picker.click() }),
    el('button', { type: 'button', textContent: '저장된 AI 파일 지우기', onclick: clearAIFiles, disabled: !stored.size }),
    picker);
  const section = (title, ...body) => el('section', {}, el('h2', { textContent: title }), ...body);
  const list = items => el('ul', {}, ...items.map(t => el('li', { innerHTML: t })));
  return el('div', { className: 'screen help' },
    section('시작하기', list([
      '<b>이미지 열기…</b>를 누르거나 이미지를 창에 끌어다 놓습니다. <kbd>Ctrl</kbd>+<kbd>O</kbd> · 캡처한 그림은 <kbd>Ctrl</kbd>+<kbd>V</kbd>로 바로 붙여넣을 수 있습니다(맥은 <kbd>⌘</kbd>).',
      '<b>여러 장 한꺼번에</b>: 이미지를 여러 장 고르거나 끌어다 놓으면, 저장할 폴더를 묻고 지금 설정·크기·저장 배율로 모두 도트화해 그 폴더에 저장합니다.',
      `<b>결과 크기</b>: ${SETTINGS.size.min}×${SETTINGS.size.min} ~ ${SETTINGS.size.max}×${SETTINGS.size.max}(${SETTINGS.size.step}px 단위)에서 고르면 바로 다시 그립니다. 배경은 자동으로 지우고 캐릭터를 캔버스에 맞춥니다.`,
      '<b>도트화</b> 탭: 설정을 바꾸면 바로 다시 계산합니다. 계산 중에도 설정을 바꿀 수 있고, 마지막 설정으로 결과가 나옵니다.',
      '<b>PNG 저장…</b>: 지금 탭의 결과를 저장합니다. <kbd>Ctrl</kbd>+<kbd>S</kbd> · 저장 배율(1·2·4·8배)은 번짐 없이 키웁니다.',
      '<b>복사</b>: 지금 탭의 결과를 저장 배율대로 클립보드에 복사합니다. <kbd>Ctrl</kbd>+<kbd>C</kbd>',
      '<b>원본 보기</b>(결과 위 버튼): 결과 자리에 원본을 같은 위치·크기로 보여 줍니다. 눌러 가며 달라진 곳을 비교하세요.',
      '결과 크기·도트화 방식·AI 업스케일·체크 항목·저장 배율은 <b>다음에 켤 때도 그대로</b>입니다.',
    ])),
    section('실험 탭 (베타)', list([
      '캐릭터를 오려 내지 않고 <b>그림 전체를 배경째</b> 도트로 바꿉니다. 도트화 탭에서 연 원본을 쓰거나, 이 탭에 다른 그림을 넣을 수 있습니다(끌어다 놓기·붙여넣기 가능).',
      '<b>도트 크기</b>: 원본 몇 픽셀을 한 칸으로 묶을지입니다. 결과는 원본 비율 그대로이고, 한 변이 512칸을 넘지 않게 맞춥니다.',
      `<b>결과 크기</b>: 긴 변 ${SETTINGS.size.min}~${SETTINGS.size.max}칸 중에서 고르면 원본 비율 그대로 그 크기에 맞춥니다(이때 도트 크기는 쓰지 않음). <b>도트 크기대로</b>로 두면 도트 크기를 씁니다.`,
      '<b>자동 추출</b>: 그림에서 가장 가까운 8~256색을 골라 원본 색감을 유지합니다. <b>커스텀 팔레트</b>: 색 칸을 눌러 정한 색만 씁니다(기본은 옛 PC 느낌의 16색).',
      '베타 기능이라 동작과 화면이 바뀔 수 있습니다.',
    ])),
    section('도트화 설정', list([
      '<b>캐릭터를 분리하지 못했을 때</b>: 오류 문구 옆의 <b>분리 없이 그대로 변환</b>을 누르면 배경을 지우지 않고 그림 전체를 그대로 도트로 바꿉니다.',
      '<b>또렷하게(작은 크기용)</b>(원본 보존): 칸 색을 평균 내지 않고 선 색이나 면 색 하나로 골라, 50×50처럼 작은 크기에서 눈·입·무늬가 뭉개지는 것을 줄입니다.',
      '<b>가장자리 반투명 없애기 · 외톨이 점 정리 · 팔레트 고정</b>: 모든 방식에 마지막으로 적용합니다. 팔레트 고정은 정해 둔 색만 쓰게 해 여러 그림의 색감을 맞춥니다(직접 입력은 16진수 색을 쉼표로).',
      '<b>강조색 지키기</b>(원본 색 살림): 색 줄이기에서 빠진 작은 강조색을 최대 3색 더 남깁니다.',
      '<b>AI 업스케일(ESRGAN)</b>: 도트화하기 전에 원본을 Real-ESRGAN으로 4배 키워 흐린 선과 잡티를 정리합니다. 자동은 원본이 결과 크기의 4배보다 작을 때만 켭니다. 6B는 더 깔끔하고, v3는 더 빠릅니다.',
      '<b>원본 보존</b>(기본): 원본 픽셀이 결과 격자 한 칸에 걸치는 넓이만큼 그대로 평균 내서, 선 굵기와 명암을 살린 투명 PNG를 만듭니다. 투명 배경 그림은 떨어진 장식까지 그대로 둡니다.',
      '<b>바깥 외곽선 1픽셀(원본 선 색)</b>(원본 보존): 투명 배경 바로 앞 가장 바깥 칸만, 원본 그 자리에 선이 있으면 원본 선 색으로 칠하고 그 바깥의 흐린 칸을 지웁니다. 흰 외곽선 장식과 발밑 그림자는 그대로 둡니다.',
      '<b>원본 색 맞추기</b>(원본 보존): 줄이면서 생긴 탁한 중간색 대신, 그 칸 원본에 실제로 있는 가장 가까운 색을 넣습니다.',
      '<b>경계 섞인 색 정리</b>(원본 보존): 줄이면서 경계에 생긴 탁한 중간색(빨강+검정 → 자주 등)을 가까운 원래 색으로 바꿉니다. 부드러운 명암은 건드리지 않습니다.',
      '<b>작은 입선 보존</b>(원본 보존): 눈 두 개 사이 아래의 작은 입 선(ω 등)이 회색으로 뭉개지지 않게 원본 선 색으로 살립니다.',
      '<b>원본 색 살림</b>: 원본의 선과 색을 살리고 색 수만 줄입니다(최대 4~64색, 기본 24색). 외곽선을 따로 씌우지 않습니다.',
      '<b>선 1픽셀로 정리</b>(원본 색 살림, 기본 켬): 큰 원본에서 선의 가운데 줄기를 찾아 1픽셀 선으로 그립니다. 선이 끊기거나 뭉치지 않고 입(ω) 같은 작은 모양이 살아납니다. 원본이 굵은 선 그림이면 끄는 편이 원래 느낌에 가깝습니다.',
      '<b>선명하게</b>(원본 색 살림, 기본 켬): 분홍·보라 같은 색의 채도를 25% 올립니다. 흰색·검정·회색은 그대로입니다. 끄면 원본 색 그대로입니다.',
      '<b>테두리·색 면 정리</b>(원본 색 살림, 기본 켬): 바깥 테두리를 끊김 없는 순검정 1px로 잇고(가시·홈·겹선 정리), 거의 같은 색을 합치고 혼자 떨어진 점을 지웁니다. 끄면 원본 테두리 그대로입니다.',
      '<b>베리 잉크</b>: 진한 잉크 윤곽과 베리 색감. <b>2.0 방식</b>: 머리·몸통을 구분하는 방식. <b>원본 직행</b>: 2.0 방식과 같은 그리기를 원본에서 바로 격자를 읽어 합니다(색 정리는 2.0 방식·원본 직행에서만).',
      '<b>최대 색</b>: 결과에 쓸 색 수(베리 잉크·2.0은 6~32). <b>검은 외곽선</b>: 바깥 테두리 1줄·2줄(베리 잉크·2.0).',
      '<b>선 추출 AI로 빠진 선 채우기</b>: 원본의 선을 AI로 읽어 끊긴 안쪽 선을 채웁니다. 160px 이상으로 크게 만들 때 효과가 큽니다.',
      '<b>몸통 경계색</b>: 검은 테두리 바로 안쪽 흰 몸통에 중간색을 넣습니다. 투명도가 클수록 흰색에 가깝습니다.',
    ])),
    section('JEV 판정', list([
      '<b>JEV 설정</b>에 LLM Gateway API 키를 넣습니다. 키는 이 컴퓨터의 암호화 저장소에 보관됩니다.',
      '<b>JEV 부위별 진단</b>: 바깥 윤곽·안쪽 선(1픽셀/2픽셀), 머리색, 투명 테두리 띠, 바깥 외곽선, 빠진 디테일(눈·입·장식·명암)을 원본과 비교합니다.',
      '<b>JEV 섞인 색 판정</b>: 섞인 색이 몰린 4곳을 골라 그대로·가까운 색·선 색 쪽 중 무엇이 나은지 봅니다.',
      '<b>JEV 선·색 비교</b>(원본 보존): 선 처리 후보를 먼저 고르고, 그 선으로 채색 후보(원본 채색·16색·32색)를 고릅니다.',
      '<b>JEV 자동 선택</b>(그 밖의 방식): 베리 잉크·2.0 방식 후보를 나란히 보여 주고 가장 나은 설정을 고릅니다.',
      'JEV가 확실하게 고른 후보는 미리 선택돼 있고, 항목마다 버튼으로 <b>직접 바꿀 수 있습니다</b>. <b>선택 적용</b>으로 그림에 반영하고, <b>적용 전으로</b>로 되돌립니다.',
      '판정할 때 배경을 분리한 원본과 후보 그림이 LLM Gateway로 전송되며, 요금은 내 키 계정에 청구됩니다. 한 번에 10~20초쯤 걸립니다.',
    ])),
    section('AI 파일',
      el('p', { innerHTML: 'AI 기능(AI 업스케일·배경 분리·선 추출)은 처음 쓸 때 아래 파일을 <b>자동으로 받아 이 프로그램의 저장소에 보관</b>합니다(받다 끊기면 이어받음). 그다음부터는 인터넷 없이 됩니다.' }),
      el('p', { innerHTML: '<b>넣을 경로는 따로 없습니다.</b> 파일은 폴더가 아니라 프로그램 저장소(IndexedDB, 이름 <code>dotmaker-ai</code>)에 들어갑니다. 아래 <b>저장된 AI 파일 지우기</b>로 지울 수 있습니다.' }),
      el('p', { innerHTML: '<b>직접 받아 넣기</b>(인터넷이 막힌 PC 등): 아래 <b>받는 주소</b>에서 파일을 받아(열리면 오른쪽 클릭 → \'다른 이름으로 링크 저장\') 어느 폴더에 두든 상관없이, <b>AI 파일 불러오기…</b>로 한꺼번에 고르면 됩니다. 파일은 크기로 알아보니 이름이 바뀌어도 괜찮지만, 내용(크기)은 그대로여야 합니다.' }),
      el('p', { className: 'muted', textContent: '필요한 파일: 배경 분리 = 실행 도구 3개 + isnetis.onnx · 선 추출 = 실행 도구 3개 + model.safetensors' }),
      el('div', { className: 'table-wrap' }, table),
      actions,
      state.aiMessage && el('p', { className: 'note', textContent: state.aiMessage })),
    section('AI 보정 (클라우드)', list([
      '<b>AI 보정</b> 탭에서 서비스를 고르고 <b>내 API 키</b>를 넣은 뒤 <b>AI 보정 실행</b>을 누릅니다. 이 탭의 <b>결과 크기</b>(도트화 탭과 같은 값)로 결과가 나옵니다. 도트화 탭 이미지 대신 <b>다른 이미지 넣기…</b>(또는 이 탭에 끌어다 놓기)로 원하는 그림을 보낼 수도 있습니다.',
      '<b>PixelLab · 다시 그리기</b>: 도트 전용 AI라 결과가 바로 도트 그림입니다(배경만 지움). \'원본에 충실하게\'와 \'원본 유지\'(0~600, 높을수록 원본에 가깝게)로 조절합니다. 약 $0.01/장.',
      '<b>PixelLab · 다듬기</b>: 지금 도트화 결과를 크기 그대로 보내 잔점·계단 가장자리·색을 정리받습니다(투명 유지). 강도 0~1, 0.1부터 올려 보세요. 요금은 결과에 표시됩니다.',
      '<b>Gemini</b>(나노 바나나 2.1) · <b>OpenAI</b>(GPT Image 2.5): 도트 느낌의 큰 그림을 받아 지금 도트화 설정으로 한 번 더 도트화합니다. 약 $0.034/장, $0.01~0.05/장.',
      '키 발급: PixelLab <code>pixellab.ai</code> 계정 · Gemini <code>aistudio.google.com/apikey</code> · OpenAI <code>platform.openai.com/api-keys</code>. 요금은 그 키의 계정에 청구됩니다(무료 사용량 없음).',
      '실행할 때마다 <b>캐릭터 그림이 그 서비스 서버로 전송</b>됩니다. 보내기 전에 받는 곳과 요금을 묻습니다. 키는 이 프로그램에만 저장되고, \'키 지우기\'로 지울 수 있습니다.',
    ])),
    section('문제 해결', list([
      '<b>설치할 때 \'Windows의 PC 보호\' 창이 뜸</b>: 개발자 서명이 없는 프로그램이라 그렇습니다. <b>추가 정보 → 실행</b>을 누르세요.',
      '<b>AI 파일을 받지 못함</b>: 인터넷 연결을 확인하세요. 회사·학교처럼 막힌 곳이면 위 표의 주소에서 파일을 직접 받아 <b>AI 파일 불러오기…</b>로 넣으면 됩니다.',
      '<b>JEV 연결 오류</b>: JEV 설정의 API 키와 LLM Gateway 잔액을 확인하세요. 오류 창에 서버가 보낸 이유가 함께 나옵니다.',
      '<b>AI가 느림</b>: 그래픽카드 가속을 못 쓰면 CPU로 돌아 느립니다. 색 배경 그림은 보통 1~3초, 처음 한 번은 모델 받기로 1분쯤 걸립니다.',
      '<b>캐릭터를 분리하지 못함</b>: 캐릭터 주위에 여백이 있는 원본이나 투명 PNG가 가장 잘 됩니다.',
    ])),
    section('맥과 윈도우', list([
      '맥용과 윈도우용은 같은 코드로 만들어 기능과 결과가 같습니다.',
    ])),
    el('p', { className: 'muted', textContent: `도트메이커 ${VERSION} · 모델: skytnt/anime-seg (Apache-2.0), p1atdev/MangaLineExtraction-hf (MIT), Real-ESRGAN (BSD-3-Clause) · 실행 도구: onnxruntime-web (MIT) · 프로그램 본체: Electron (MIT)` }),
  );
}

// ───────────── 그리기
/** 처리 중 문구만 바꾼다(모델 받기 진행률처럼 자주 바뀔 때). */
function updateStatus() {
  const status = document.querySelector('.status');
  if (!status || !state.busy) return update();
  if (status.lastChild?.nodeType === Node.TEXT_NODE && status.querySelector('.spinner')) status.lastChild.textContent = state.busy;
  else update();
}

function update() {
  // 실험 탭은 결과가 비어 있으면 먼저 만든다(저장·복사 버튼 상태가 결과를 보고 정해지므로 맨 앞에서).
  if (state.stage === 'lab' && !state.lab.result) labRun();
  $('file-name').textContent = state.fileName ?? '';
  $('save').disabled = $('copy').disabled = !result() || Boolean(state.busy);
  for (const tab of document.querySelectorAll('[data-stage]')) {
    const selected = tab.dataset.stage === state.stage;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }
  $('scale').value = String(state.exportScale);
  const focused = document.activeElement?.getAttribute('aria-label');
  const scroll = $('panel').firstChild?.scrollTop ?? 0;
  const sheetScroll = document.querySelector('.sheet')?.scrollTop ?? 0;
  $('panel').replaceChildren(screen(state.stage));
  $('panel').firstChild.scrollTop = scroll;
  const sheet = document.querySelector('.sheet');
  if (sheet) sheet.scrollTop = sheetScroll;
  if (focused === '가로' || focused === '세로') {
    const input = document.querySelector(`[aria-label="${focused}"]`);
    input?.focus();
    input?.setSelectionRange(input.value.length, input.value.length);
  }
}

// ───────────── 시작
$('version').textContent = VERSION;
checkUpdate();
$('open').onclick = () => $('file').click();
$('file').onchange = event => { openFiles([...event.target.files]); event.target.value = ''; };
$('save').onclick = save;
$('copy').onclick = copyResult;
$('scale').onchange = event => { state.exportScale = Number(event.target.value); store.set('exportScale', state.exportScale); };
for (const tab of document.querySelectorAll('[data-stage]')) {
  tab.onclick = () => { state.stage = tab.dataset.stage; update(); };
}
$('tabs').onkeydown = event => {
  const order = Object.keys(STAGES);
  const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
  if (!step) return;
  state.stage = order[(order.indexOf(state.stage) + step + order.length) % order.length];
  update();
  document.querySelector(`[data-stage="${state.stage}"]`).focus();
};
document.addEventListener('keydown', event => {
  if (!(event.ctrlKey || event.metaKey)) return;
  const key = event.key.toLowerCase();
  if (key === 'o') { event.preventDefault(); $('file').click(); }
  if (key === 's') { event.preventDefault(); save(); }
});
let dragDepth = 0;
document.addEventListener('dragenter', event => { event.preventDefault(); dragDepth++; document.body.classList.add('dragging'); });
document.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
document.addEventListener('dragover', event => event.preventDefault());
document.addEventListener('drop', event => {
  event.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('dragging');
  takeFiles([...(event.dataTransfer?.files ?? [])]);
});
// 붙여넣기: 클립보드의 그림(캡처 등)을 연다. 글자 입력 칸에 붙여넣을 때는 건드리지 않는다.
document.addEventListener('paste', event => {
  const files = [...(event.clipboardData?.files ?? [])];
  if (!files.some(f => f.type.startsWith('image/'))) return;
  event.preventDefault();
  takeFiles(files.map((f, k) => (f.name && f.name !== 'image.png' ? f : new File([f], `붙여넣은 그림${files.length > 1 ? k + 1 : ''}.png`, { type: f.type }))));
});
// 복사: 글자를 고르지 않았을 때 Ctrl/Cmd+C는 결과 그림을 복사한다.
document.addEventListener('copy', event => {
  if (String(getSelection()) || /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName) || !result()) return;
  event.preventDefault();
  copyResult();
});
function takeFiles(files) {
  const file = files.find(f => f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(f.name));
  if (!file) return;
  // AI 보정 탭에서는 그 탭의 그림으로 넣고, 다른 탭에서는 도트화할 원본으로 연다.
  if (state.stage === 'repair' || state.stage === 'lab') {
    loadPictureFile(file).then(picture => (state.stage === 'lab' ? setLabInput(picture, file.name) : setCloudInput(picture, file.name)))
      .catch(error => { state.error = error.message; update(); });
  } else openFiles(files);
}
update();
