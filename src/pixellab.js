// PixelLab API(작업실 도구). 화면에서 부른다. 키는 AI 보정과 같은 것(cloudKey 'pixellab')을 쓴다.
// 오래 걸리는 도구는 작업 번호(background_job_id)를 받고 끝날 때까지 상태를 확인한다(processing → completed / failed).
// 입력 형식은 https://api.pixellab.ai/v2/openapi.json 기준(2026-11-08 확인).
const PL = 'https://api.pixellab.ai/v2';
const b64 = base64 => ({ type: 'base64', base64, format: 'png' });
const sized = (base64, w, h) => ({ image: b64(base64), size: { width: w, height: h } });

/** 응답 어디에 있든 base64 그림을 모두 모은다(images[] · image · last_response 등). */
function findImages(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (typeof node.base64 === 'string' && node.base64.length > 64) { out.push(node.base64); return out; }
  for (const value of Array.isArray(node) ? node : Object.values(node)) findImages(value, out);
  return out;
}

function usageText(usage) {
  if (!usage) return '';
  if (usage.type === 'generations' && usage.generations !== null && usage.generations !== undefined) return ` · 이번 사용 생성 ${usage.generations}회`;
  if (usage.usd !== null && usage.usd !== undefined) return ` · 이번 요금 $${Number(usage.usd).toFixed(4)}`;
  return '';
}

async function plPost(key, path, body) {
  const response = await send('PixelLab', PL + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await failure('PixelLab', response);
  return response.json();
}

/** 작업을 보내고 끝날 때까지 3초마다 확인한다. 바로 결과를 주는 도구면 그대로 돌려준다. */
async function plRun(key, path, body, progress, label) {
  const first = await plPost(key, path, body);
  const jobId = first.background_job_id;
  if (!jobId) return { body: first, usage: first.usage };
  const started = Date.now();
  for (;;) {
    const seconds = Math.round((Date.now() - started) / 1000);
    progress(`${label} (${seconds}초째, PixelLab이 그리는 중)`);
    if (seconds > 480) throw new CloudError('PixelLab: 8분이 지나도 끝나지 않았습니다. 잠시 뒤 PixelLab 사이트의 갤러리를 확인해 주세요.');
    await new Promise(done => setTimeout(done, 3000));
    const response = await send('PixelLab', `${PL}/background-jobs/${encodeURIComponent(jobId)}`, { headers: { authorization: `Bearer ${key}` } });
    if (!response.ok) throw await failure('PixelLab', response);
    const job = await response.json();
    if (job.status === 'completed') return { body: job.last_response ?? job, usage: job.usage ?? first.usage };
    if (job.status === 'failed') {
      const detail = job.last_response?.detail ?? job.last_response?.error ?? job.last_response?.message ?? '';
      throw new CloudError(`PixelLab: 작업이 실패했습니다.${detail ? ' — ' + String(detail).slice(0, 200) : ''}`);
    }
  }
}

/** PixelLab 결과 → { pictures: [곧은 RGBA 그림], usage } */
async function plPictures(result) {
  const list = findImages(result.body);
  if (!list.length) throw new CloudError('PixelLab: 응답에 그림이 없습니다.');
  const pictures = [];
  for (const one of list) {
    const image = await decode(base64ToBlob(one));
    pictures.push({ w: image.w, h: image.h, bytes: Raster.fromPremultiplied(image.data, image.w, image.h).straightBytes() });
  }
  return { pictures, usage: result.usage };
}

/** 그림(곧은 RGBA)을 PNG base64로(크기·투명 그대로) */
const pngOf = picture => exactPNG(picture);

/** 마스크 칸(Uint8Array, 1=다시 그릴 곳) → 흰색(다시 그림)/검정(유지) PNG base64 */
async function maskPNG(mask, w, h) {
  const bytes = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { const v = mask[i] ? 255 : 0; bytes[i * 4] = v; bytes[i * 4 + 1] = v; bytes[i * 4 + 2] = v; bytes[i * 4 + 3] = 255; }
  return exactPNG({ w, h, bytes });
}

// ── 도구 목록. 각 도구는 입력 크기 조건(check)과 실행(run)을 가진다. run은 { pictures, usage, frames? }를 돌려준다.
const LAB_TOOLS = {
  pro: {
    name: '이미지 → 도트 Pro', note: '캐릭터 원본을 보내 고품질 도트로 바꿉니다. 결과 크기는 PixelLab이 정합니다.',
    async run(key, ctx, o, progress) {
      const body = { image: b64(await pngOf(ctx.source)), seed: 7 };
      if (o.description) body.description = o.description;
      if (o.maxColors) body.target_palette = { max_colors: o.maxColors };
      const path = o.flash ? '/image-to-pixelart-pro-flash' : '/image-to-pixelart-pro';
      return plPictures(await plRun(key, path, body, progress, o.flash ? 'Pro Flash 변환' : 'Pro 변환'));
    },
  },
  edit: {
    name: '글로 고치기', note: '작업 그림을 문장대로 고칩니다(자세·구도 유지). 32~512px.',
    check: p => (p.w < 32 || p.h < 32 || p.w > 512 || p.h > 512) && '작업 그림이 32~512px이어야 합니다.',
    async run(key, ctx, o, progress) {
      if (!o.description) throw new CloudError('고칠 내용을 적어 주세요.');
      const p = ctx.work;
      return plPictures(await plRun(key, '/edit-images-v2', {
        method: 'edit_with_text', description: o.description, image_size: { width: p.w, height: p.h },
        edit_images: [{ image: b64(await pngOf(p)), width: p.w, height: p.h }], no_background: true, seed: 7,
      }, progress, '글로 고치기'));
    },
  },
  inpaint: {
    name: '부분 다시 그리기', note: '작업 그림 위에 다시 그릴 곳을 칠하고, 그곳에 그릴 내용을 적습니다. 32~512px.',
    check: p => (p.w < 32 || p.h < 32 || p.w > 512 || p.h > 512) && '작업 그림이 32~512px이어야 합니다.',
    async run(key, ctx, o, progress) {
      if (!o.description) throw new CloudError('칠한 곳에 그릴 내용을 적어 주세요.');
      if (!ctx.mask?.some(Boolean)) throw new CloudError('다시 그릴 곳을 작업 그림 위에 칠해 주세요.');
      const p = ctx.work;
      return plPictures(await plRun(key, '/inpaint-v3', {
        description: o.description, inpainting_image: sized(await pngOf(p), p.w, p.h),
        mask_image: sized(await maskPNG(ctx.mask, p.w, p.h), p.w, p.h), crop_to_mask: true, seed: 7,
      }, progress, '부분 다시 그리기'));
    },
  },
  colors: {
    name: '색 줄이기', note: '작업 그림의 색을 정한 수로 줄입니다(0이면 자동).',
    async run(key, ctx, o, progress) {
      progress('색 줄이는 중');
      const body = { images: [b64(await pngOf(ctx.work))], dithering: o.dither ? '2x2' : 'none' };
      if (o.numColors) body.num_colors = o.numColors;
      const result = await plRun(key, '/reduce-colors', body, progress, '색 줄이기');
      // 응답에는 팔레트 그림도 들어 있어서 결과 그림(images)만 고른다.
      return plPictures({ body: { images: result.body.images }, usage: result.usage });
    },
  },
  background: {
    name: '배경 지우기', note: '작업 그림의 배경을 지웁니다. 가로×세로 160,000칸(400×400) 이하.',
    check: p => p.w * p.h > 160000 && '작업 그림이 400×400 넓이 이하여야 합니다.',
    async run(key, ctx, o, progress) {
      progress('배경 지우는 중');
      return plPictures(await plRun(key, '/remove-background', {
        image: b64(await pngOf(ctx.work)), image_size: { width: ctx.work.w, height: ctx.work.h },
        background_removal_task: o.complex ? 'remove_complex_background' : 'remove_simple_background',
      }, progress, '배경 지우기'));
    },
  },
  resize: {
    name: '크기 바꾸기', note: '도트 느낌을 살려 크기를 바꿉니다. 16~200px, 한 번에 절반~2배가 좋습니다.',
    check: p => (p.w < 16 || p.h < 16 || p.w > 200 || p.h > 200) && '작업 그림이 16~200px이어야 합니다.',
    async run(key, ctx, o, progress) {
      const p = ctx.work, s = o.scale, w = Math.max(16, Math.min(200, Math.round(p.w * s))), h = Math.max(16, Math.min(200, Math.round(p.h * s)));
      return plPictures(await plRun(key, '/resize', {
        description: o.description || 'chibi character', reference_image: b64(await pngOf(p)),
        reference_image_size: { width: p.w, height: p.h }, target_size: { width: w, height: h }, no_background: true, seed: 7,
      }, progress, '크기 바꾸기'));
    },
  },
  unzoom: {
    name: '원래 칸 크기로(unzoom)', note: '확대된 도트(한 칸이 여러 픽셀)를 원래 크기로 되돌립니다. AI 그림을 정리할 때 씁니다.',
    async run(key, ctx, o, progress) {
      return plPictures(await plRun(key, '/unzoom', { image: b64(await pngOf(ctx.work)), quantize: 0 }, progress, '원래 칸 크기로'));
    },
  },
  rotate: {
    name: '8방향 돌리기', note: '작업 그림을 기준으로 8방향 그림을 만듭니다. 256px 이하, 30초~3분.',
    check: p => (p.w > 256 || p.h > 256) && '작업 그림이 256px 이하여야 합니다.', frames: true,
    async run(key, ctx, o, progress) {
      const body = { first_frame: b64(await pngOf(ctx.work)), no_background: true, seed: 7 };
      if (o.description) body.description = o.description;
      return plPictures(await plRun(key, '/generate-8-rotations-v3', body, progress, '8방향 돌리기'));
    },
  },
  animate: {
    name: '동작 애니메이션', note: '작업 그림이 문장대로 움직이는 프레임을 만듭니다(예: walking). 256px 이하, 30초~3분.',
    check: p => (p.w > 256 || p.h > 256) && '작업 그림이 256px 이하여야 합니다.', frames: true,
    async run(key, ctx, o, progress) {
      if (!o.action) throw new CloudError('동작을 적어 주세요(예: walking, jumping, waving).');
      const p = ctx.work, budget = Math.floor(524288 / (p.w * p.h));
      const count = Math.max(4, Math.min(16, o.frameCount, budget - (budget % 2)));
      return plPictures(await plRun(key, '/animate-with-text-v3', {
        first_frame: b64(await pngOf(p)), action: o.action, frame_count: count, no_background: true, seed: 7,
      }, progress, `동작 애니메이션 ${count}프레임`));
    },
  },
  outfit: {
    name: '옷 입히기', note: '참고 그림의 옷·모습을 마지막 애니메이션(또는 8방향) 프레임들에 입힙니다. 32~256px.',
    frames: true,
    async run(key, ctx, o, progress) {
      const frames = ctx.frames ?? [];
      if (frames.length < 2) throw new CloudError('먼저 동작 애니메이션이나 8방향 돌리기로 프레임을 만들어 주세요.');
      if (!ctx.reference) throw new CloudError('입힐 옷이 있는 참고 그림을 불러와 주세요.');
      const w = frames[0].w, h = frames[0].h;
      if (w < 32 || h < 32 || w > 256 || h > 256) throw new CloudError('프레임이 32~256px이어야 합니다.');
      const limit = Math.max(w, h) <= 64 ? 15 : Math.max(w, h) <= 80 ? 8 : 3;
      const use = frames.slice(0, limit);
      const ref = ctx.reference.w > 256 || ctx.reference.h > 256 ? fitPicture(ctx.reference, 256, 256) : ctx.reference;
      const body = {
        reference_image: sized(await pngOf(ref), ref.w, ref.h),
        frames: await Promise.all(use.map(async f => sized(await pngOf(f), f.w, f.h))),
        image_size: { width: w, height: h }, no_background: true, seed: 7,
      };
      if (o.description) body.additional_instructions = o.description;
      const out = await plPictures(await plRun(key, '/transfer-outfit-v2', body, progress, `옷 입히기 ${use.length}프레임`));
      if (use.length < frames.length) out.note = `이 크기는 한 번에 ${limit}프레임까지라 앞 ${limit}프레임만 보냈습니다.`;
      return out;
    },
  },
};

/** 그림을 maxW×maxH 안에 들어가게 정수 단위로 줄인다(칸마다 가장 많은 색, 도트가 번지지 않게). 이미 작으면 그대로. */
function fitPicture(picture, maxW, maxH) {
  const k = Math.max(1, Math.ceil(Math.max(picture.w / maxW, picture.h / maxH)));
  if (k === 1) return picture;
  const w = Math.floor(picture.w / k), h = Math.floor(picture.h / k), src = new Uint32Array(picture.bytes.buffer.slice(0)), out = new Uint32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const votes = new Map();
    for (let v = 0; v < k; v++) for (let u = 0; u < k; u++) { const c = src[(y * k + v) * picture.w + x * k + u]; votes.set(c, (votes.get(c) ?? 0) + 1); }
    out[y * w + x] = [...votes.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }
  return { w, h, bytes: new Uint8ClampedArray(out.buffer) };
}

/** 프레임들을 가로로 이어 붙인 스프라이트 시트 */
function spriteSheet(frames) {
  const w = frames[0].w, h = Math.max(...frames.map(f => f.h)), sheet = new Uint32Array(w * frames.length * h);
  frames.forEach((f, n) => {
    const src = new Uint32Array(f.bytes.buffer.slice(0));
    for (let y = 0; y < f.h; y++) for (let x = 0; x < Math.min(w, f.w); x++) sheet[y * w * frames.length + n * w + x] = src[y * f.w + x];
  });
  return { w: w * frames.length, h, bytes: new Uint8ClampedArray(sheet.buffer) };
}
