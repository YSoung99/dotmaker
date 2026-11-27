// 클라우드 AI 보정(화면에서 부른다). 사용자가 넣은 자기 API 키로 각 서비스에 그림을 보내 'AI 그림'을 받는다.
// 키는 프로그램 본체가 운영체제 암호화 저장소에 보관하고, 화면은 끝 4자리만 기억한다. 보내기 전에 받는 곳과 대략의 요금을 묻는다.
// 세 서비스 모두 브라우저(file:// 포함) 호출을 허용한다(2026-11-08 확인). Gemini는 Api-Revision 헤더를 보내면 막힌다.
const CLOUD = {
  pixellab: {
    name: 'PixelLab', detail: '도트 전용 · 결과가 바로 도트 그림', host: 'api.pixellab.ai', price: '1장 약 $0.01',
    keyPage: 'https://www.pixellab.ai/', keyHint: 'PixelLab 계정의 API 토큰',
  },
  gemini: {
    name: 'Gemini', detail: '나노 바나나 2.1 · 도트 느낌 그림 → 도트화', host: 'generativelanguage.googleapis.com', price: '1장 약 $0.034',
    keyPage: 'https://aistudio.google.com/apikey', keyHint: 'Google AI Studio의 API 키',
  },
  openai: {
    name: 'OpenAI', detail: 'GPT Image 2.5 · 도트 느낌 그림 → 도트화', host: 'api.openai.com',
    price: '쓴 토큰만큼(그림 출력 100만 토큰당 $30, 품질이 높을수록 많이 씀 · 실제 요금은 결과에 표시)',
    keyPage: 'https://platform.openai.com/api-keys', keyHint: 'OpenAI 플랫폼의 API 키(sk-…)',
  },
};
// OpenAI 모델과 토큰 요금(달러/100만 토큰). 두 모델은 요금이 같고 품질마다 쓰는 토큰 수가 다르다(2026-11-18 공식 문서 확인).
const OPENAI_MODELS = { flare: 'gpt-image-2.5-flare', sunburst: 'gpt-image-2.5-sunburst' };
const OPENAI_RATES = { imageInput: 8, textInput: 5, output: 30 };

/** OpenAI 응답의 usage(토큰 수)로 이번 요금(달러)을 계산한다. usage가 없으면 null. */
function openaiCost(usage) {
  if (!usage) return null;
  const image = usage.input_tokens_details?.image_tokens ?? 0;
  const text = usage.input_tokens_details?.text_tokens ?? Math.max(0, (usage.input_tokens ?? 0) - image);
  return (image * OPENAI_RATES.imageInput + text * OPENAI_RATES.textInput + (usage.output_tokens ?? 0) * OPENAI_RATES.output) / 1e6;
}

const CLOUD_PROMPT = 'Redraw this exact character as a clean pixel art sprite. Keep the same pose, face, expression, proportions and colors. '
  + 'Crisp 1-pixel dark outlines, flat colors with a small palette, no anti-aliasing, no blur, plain white background, nothing else in the image.';

// 설치형 본체(preload가 연 dotmakerDesktop). jev-app.js보다 먼저 붙어도 되게 직접 찾는다. 브라우저로 열면 null.
const cloudDesktop = () => globalThis.dotmakerDesktop ?? null;

// 키 값은 요청을 보낼 때만 get으로 꺼낸다. 암호화 저장소를 못 쓰면(본체 없음·저장소 오류) 이번 실행 동안만 메모리에 둔다.
const cloudKey = {
  memory: {},
  tails: {},   // 서비스마다 저장된 키의 끝 4자리('' = 없음)
  tail: id => cloudKey.tails[id] ?? '',
  async get(id) {
    const desktopApi = cloudDesktop();
    const stored = desktopApi ? await desktopApi.getCloudKey(id).catch(() => '') : '';
    return stored || cloudKey.memory[id] || '';
  },
  /** 저장하고, 암호화 저장소에 넣었으면 true(못 넣어 이번 실행 동안만 기억하면 false). */
  async set(id, key) {
    cloudKey.tails[id] = key.slice(-4);
    try {
      await cloudDesktop().setCloudKey(id, key);
      delete cloudKey.memory[id];
      return true;
    } catch {
      cloudKey.memory[id] = key;
      return false;
    }
  },
  async clear(id) {
    delete cloudKey.memory[id];
    cloudKey.tails[id] = '';
    await cloudDesktop()?.clearCloudKey(id);
  },
  /** 시작할 때: 예전 버전이 localStorage에 평문으로 둔 키를 암호화 저장소로 옮기고 지운 뒤, 끝 4자리를 읽어 둔다. */
  async load() {
    for (const id of Object.keys(CLOUD)) {
      let legacy = null;
      try { legacy = localStorage.getItem('dotmaker.key.' + id); } catch { /* 저장소를 못 읽으면 옮길 것도 없다 */ }
      if (legacy && (await cloudKey.set(id, legacy))) localStorage.removeItem('dotmaker.key.' + id);
      cloudKey.tails[id] = (await cloudKey.get(id)).slice(-4);
    }
  },
};

/** 그림(곧은 RGBA 바이트)을 흰 바탕 PNG(base64)로. width×height 칸에 비율 유지해 가운데 둔다. */
async function whitePNG(picture, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, width, height);
  const source = toCanvas(picture);
  const scale = Math.min(width / picture.w, height / picture.h) * 0.92;
  const dw = Math.round(picture.w * scale), dh = Math.round(picture.h * scale);
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, Math.round((width - dw) / 2), Math.round((height - dh) / 2), dw, dh);
  const blob = await new Promise(done => canvas.toBlob(done, 'image/png'));
  return { blob, base64: await blobToBase64(blob) };
}
const blobToBase64 = blob => new Promise(done => {
  const reader = new FileReader();
  reader.onload = () => done(String(reader.result).split(',')[1]);
  reader.readAsDataURL(blob);
});
/** base64 앞부분으로 그림 종류를 알아낸다(서비스가 PNG 대신 JPEG·WebP를 줄 때가 있다). */
function base64Mime(b64) {
  if (b64.startsWith('iVBOR')) return 'image/png';
  if (b64.startsWith('/9j/')) return 'image/jpeg';
  if (b64.startsWith('UklGR')) return 'image/webp';
  return 'image/png';
}
const base64ToBlob = (b64, type = base64Mime(b64)) => new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], { type });

class CloudError extends Error {}
/** 오류 본문의 설명을 글로. FastAPI의 detail 배열([{ loc, msg }])·객체도 읽을 수 있게 푼다. */
function cloudDetail(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(cloudDetail).filter(Boolean).join('; ');
  if (typeof value === 'object') {
    const where = Array.isArray(value.loc) ? value.loc.filter(part => part !== 'body').join('.') : '';
    const text = value.msg ?? value.message ?? value.detail;
    if (text != null) return where ? `${where}: ${cloudDetail(text)}` : cloudDetail(text);
    try { return JSON.stringify(value); } catch { return ''; }
  }
  return String(value);
}
async function failure(service, response) {
  let detail = '';
  try {
    const body = await response.json();
    detail = cloudDetail(body?.error?.message ?? body?.error ?? body?.detail ?? body?.message);
  } catch { /* 본문 없음 */ }
  const reason = { 400: '요청을 받아 주지 않았습니다', 401: 'API 키가 맞지 않습니다', 402: '잔액·크레딧이 부족합니다',
    403: '이 키로는 쓸 수 없습니다(권한·결제 설정 확인)', 404: '모델이나 주소를 찾지 못했습니다',
    422: '보낸 그림이나 설정 값을 받아 주지 않았습니다(크기·형식 확인)', 429: '요청이 너무 많거나 사용 한도를 넘었습니다',
    500: '서비스 쪽에서 오류가 났습니다. 잠시 뒤 다시 해 보세요', 503: '서비스가 지금 바쁘거나 점검 중입니다. 잠시 뒤 다시 해 보세요' }[response.status]
    ?? '서버 오류가 났습니다';
  return new CloudError(`${service}: ${reason} (HTTP ${response.status})${detail ? ' — ' + detail.slice(0, 200) : ''}`);
}
const CLOUD_TIMEOUT = 180_000;
async function send(service, url, options) {
  try {
    return await fetch(url, { ...options, signal: AbortSignal.timeout(CLOUD_TIMEOUT) });
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw new CloudError(`${service}: ${CLOUD_TIMEOUT / 60_000}분 안에 응답이 오지 않아 멈췄습니다. 잠시 뒤 다시 해 보세요(요금이 청구됐을 수 있어요).`);
    }
    throw new CloudError(`${service}: 서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.`);
  }
}

/**
 * 응답 JSON 어디에 있든 base64 그림을 찾는다(서비스마다 모양이 달라서).
 * Gemini가 생각 중에 만든 그림(thought: true)은 건너뛰고, 여러 장이면 마지막(최종) 그림을 쓴다.
 */
function findImage(node) {
  let found = null;
  const visit = value => {
    if (!value || typeof value !== 'object' || value.thought === true) return;
    const inline = value.inline_data ?? value.inlineData;
    if (inline?.data) { found = inline.data; return; }
    if (value.type === 'image' && typeof value.data === 'string') { found = value.data; return; }
    if (typeof value.b64_json === 'string') { found = value.b64_json; return; }
    for (const child of Array.isArray(value) ? value : Object.values(value)) visit(child);
  };
  visit(node);
  return found;
}

/** 그림을 그대로(크기·투명 유지) PNG base64로 */
async function exactPNG(picture) {
  const blob = await new Promise(done => toCanvas(picture).toBlob(done, 'image/png'));
  return blobToBase64(blob);
}

/**
 * PixelLab 다듬기(correct-pixelart): 도트 그림을 크기 그대로 보내 잔점·계단 가장자리·색을 정리받는다. 투명은 유지된다.
 * strength 0~1(PixelLab 권장: 0.1부터).
 */
async function cloudCorrect(key, picture, strength) {
  const response = await send('PixelLab', 'https://api.pixellab.ai/v2/correct-pixelart', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ images: [{ type: 'base64', base64: await exactPNG(picture), format: 'png' }], strength }),
  });
  if (!response.ok) throw await failure('PixelLab', response);
  const body = await response.json();
  const b64 = body?.images?.[0]?.base64 ?? findImage(body);
  if (!b64) throw new CloudError('PixelLab: 응답에 그림이 없습니다.');
  return { blob: base64ToBlob(b64), cost: body?.usage?.usd ?? null };
}

/**
 * subject: 캐릭터 그림(곧은 RGBA), size: 결과 캔버스 [w, h], options: 서비스별 설정.
 * 돌려주는 것: { blob: 받은 그림(PNG), pixel: 이미 도트 그림인지, cost: 서버가 알려 준 요금(달러, 없으면 null) }
 */
async function cloudPaint(id, key, subject, size, options) {
  const [w, h] = size;
  if (id === 'pixellab') {
    // 입력은 출력의 약 4배가 좋다(PixelLab 안내). 한 변 2048px까지.
    const k = Math.max(1, Math.min(4, Math.floor(2048 / Math.max(w, h))));
    const input = await whitePNG(subject, w * k, h * k);
    const response = await send('PixelLab', 'https://api.pixellab.ai/v2/image-to-pixelart', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        image: { type: 'base64', base64: input.base64, format: 'png' },
        image_size: { width: w * k, height: h * k },
        output_size: { width: w, height: h },
        text_guidance_scale: 8,
        init_image_strength: options.strength,
        fixer: options.faithful,
        seed: 7,
      }),
    });
    if (!response.ok) throw await failure('PixelLab', response);
    const body = await response.json();
    const b64 = body?.image?.base64 ?? findImage(body);
    if (!b64) throw new CloudError('PixelLab: 응답에 그림이 없습니다.');
    return { blob: base64ToBlob(b64), pixel: true, cost: body?.usage?.usd ?? null };
  }
  const input = await whitePNG(subject, 1024, 1024);
  if (id === 'gemini') {
    const headers = { 'content-type': 'application/json', 'x-goog-api-key': key };
    const base = 'https://generativelanguage.googleapis.com/v1beta';
    let response = await send('Gemini', `${base}/interactions`, {
      method: 'POST', headers,
      body: JSON.stringify({
        model: 'gemini-nano-banana-2.1',
        input: [{ type: 'text', text: CLOUD_PROMPT }, { type: 'image', mime_type: 'image/png', data: input.base64 }],
        response_format: { type: 'image', mime_type: 'image/png', aspect_ratio: '1:1', image_size: '1K' },
      }),
    });
    // 새 방식(interactions)을 못 쓰는 키·지역이면 예전 방식(generateContent)으로 한 번 더
    if (response.status === 400 || response.status === 404) {
      response = await send('Gemini', `${base}/models/gemini-nano-banana-2.1:generateContent`, {
        method: 'POST', headers,
        body: JSON.stringify({
          contents: [{ parts: [{ text: CLOUD_PROMPT }, { inline_data: { mime_type: 'image/png', data: input.base64 } }] }],
          generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '1:1', imageSize: '1K' } },
        }),
      });
    }
    if (!response.ok) throw await failure('Gemini', response);
    const b64 = findImage(await response.json());
    if (!b64) throw new CloudError('Gemini: 응답에 그림이 없습니다(안전 필터에 걸렸을 수 있어요).');
    return { blob: base64ToBlob(b64), pixel: false, cost: null };
  }
  const form = new FormData();
  form.append('model', OPENAI_MODELS[options.model] ?? OPENAI_MODELS.sunburst);
  form.append('image', input.blob, 'input.png');
  form.append('prompt', CLOUD_PROMPT);
  form.append('size', '1024x1024');
  form.append('quality', options.quality);
  form.append('output_format', 'png');
  const response = await send('OpenAI', 'https://api.openai.com/v1/images/edits', {
    method: 'POST', headers: { authorization: `Bearer ${key}` }, body: form,
  });
  if (!response.ok) throw await failure('OpenAI', response);
  const body = await response.json();
  const b64 = findImage(body);
  if (!b64) throw new CloudError('OpenAI: 응답에 그림이 없습니다.');
  return { blob: base64ToBlob(b64), pixel: false, cost: openaiCost(body.usage) };
}
