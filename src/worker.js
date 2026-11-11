// 작업자(Web Worker): 변환과 AI를 화면과 따로 돌려 처리 중에도 창이 멈추지 않게 한다.
// 일은 들어온 순서대로 하나씩 한다. 원본·캐릭터·선 지도는 여기 두고, 화면에는 결과 그림만 보낸다.
let current = null; // { raw, wanted, upscaled, skipped, original, masked, subject, reduced, lines, faithful, whole }

const picture = raster => ({ w: raster.grid.w, h: raster.grid.h, bytes: raster.straightBytes() });

/** 원본 보존은 투명 그림의 떨어진 장식까지 살리고 원본에서 바로 격자를 읽어, 캐릭터·축소를 따로 둔다. */
function faithfulParts() {
  const { w, h } = current.reduced.image.grid;
  if (!current.faithful || current.faithful.w !== w || current.faithful.h !== h) {
    const subject = current.whole ? Subject.whole(current.original) : Subject.extract(current.original, current.masked, true);
    current.faithful = { w, h, subject, reduced: reduceDirect(subject, w, h) };
  }
  return current.faithful;
}

/** 원본 직행은 캐릭터는 그대로 두고, 축소만 원본에서 바로 격자를 읽는다(맥판과 같음). */
function directParts() {
  const { w, h } = current.reduced.image.grid;
  if (!current.direct || current.direct.w !== w || current.direct.h !== h) {
    current.direct = { w, h, subject: current.subject, reduced: reduceDirect(current.subject, w, h) };
  }
  return current.direct;
}

function finish(id, settings) {
  const parts = settings.method === 'faithful' ? faithfulParts() : settings.method === 'direct' ? directParts() : current;
  const dotted = render(parts.subject, parts.reduced, settings, current.lines);
  const reduced = picture(parts.reduced.image), dot = picture(dotted.image);
  const sharpened = current.upscaled ? ` · AI 업스케일 ${current.upscaled === 'esr6b' ? '6B' : 'v3'}`
    : current.skipped ? ` · AI 업스케일 건너뜀(${current.skipped})` : '';
  const whole = current.whole ? ' · 배경 분리 없이 그대로' : '';
  self.postMessage({ id, type: 'done', reduced, dotted: dot, status: dotStatus(settings, dotted) + sharpened + whole },
    [reduced.bytes.buffer, dot.bytes.buffer]);
}

async function handle(job) {
  const progress = label => self.postMessage({ id: job.id, type: 'progress', label });
  try {
    if (job.type === 'open') {
      const { original, w, h, settings } = job;
      current = await load(original, w, h, settings, progress, Boolean(job.whole));
      finish(job.id, settings);
    } else if (job.type === 'resize') {
      // 결과 크기가 바뀌면 '자동' AI 업스케일을 쓸지가 달라질 수 있다.
      if (upscaleModel(current.raw, job.settings.upscale, Math.max(job.w, job.h)) !== current.wanted) {
        current = await load(current.raw, job.w, job.h, job.settings, progress, current.whole);
      } else {
        current = { ...current, reduced: reduce(current.subject, job.w, job.h) };
      }
      finish(job.id, job.settings);
    } else if (job.type === 'redot') {
      const { w, h } = current.reduced.image.grid;
      if (upscaleModel(current.raw, job.settings.upscale, Math.max(w, h)) !== current.wanted) {
        current = await load(current.raw, w, h, job.settings, progress);
      } else if (wantsLines(job.settings) && !current.lines) {
        current.lines = await extractLines(current.subject, progress);
      }
      finish(job.id, job.settings);
    } else if (job.type === 'jev') {
      // JEV에 물을 항목(확대 그림·후보·바꿀 칸). 요청은 화면이 프로그램 본체를 거쳐 보낸다.
      const { subject, reduced } = faithfulParts();
      const now = Raster.fromStraight(job.current.bytes, job.current.w, job.current.h);
      self.postMessage({ id: job.id, type: 'done', ...jevProbes(subject, reduced, now, job.focus) });
    } else if (job.type === 'jevStrokes') {
      // JEV 선·색 비교 1단계: 원본(캐릭터)과 선 처리 후보
      const { subject, reduced } = faithfulParts();
      current.jevStrokes = strokeCandidates(reduced);
      self.postMessage({ id: job.id, type: 'done', reference: picture(subject),
        candidates: current.jevStrokes.map(c => ({ label: c.label, picture: picture(c.image) })) });
    } else if (job.type === 'jevFills') {
      // 2단계: 고른 선 처리로 채색 후보
      const fills = fillCandidates(current.jevStrokes[job.index], faithfulParts().reduced);
      self.postMessage({ id: job.id, type: 'done', candidates: fills.map(c => ({ label: c.label, picture: picture(c.image) })) });
    } else if (job.type === 'jevRender') {
      // JEV 자동 선택: 설정 후보마다 그린 결과
      if (job.list.some(wantsLines) && !current.lines) current.lines = await extractLines(current.subject, progress);
      const results = job.list.map(settings => {
        const parts = settings.method === 'faithful' ? faithfulParts() : settings.method === 'direct' ? directParts() : current;
        const dotted = render(parts.subject, parts.reduced, settings, current.lines);
        return { reduced: picture(parts.reduced.image), dotted: picture(dotted.image), status: dotStatus(settings, dotted) };
      });
      self.postMessage({ id: job.id, type: 'done', results });
    } else if (job.type === 'subject') {
      // 클라우드 AI에 보낼 캐릭터 그림
      const subject = picture(current.subject);
      self.postMessage({ id: job.id, type: 'done', subject }, [subject.bytes.buffer]);
    } else if (job.type === 'cloud') {
      // 클라우드 AI 그림 마무리. 도트 그림(PixelLab)은 배경만 지우고, 아니면 지금 설정으로 도트화한다.
      const { image, w, h, settings, pixel } = job;
      let result, status;
      if (pixel) {
        const raster = Raster.from(image);
        removePaleBackdrop(raster);
        result = raster;
        status = `AI 도트 그림 · 배경 지움 · ${raster.grid.w}×${raster.grid.h}`;
      } else {
        const { image: source } = await tryUpscale(image, upscaleModel(image, settings.upscale, Math.max(w, h)), progress);
        const prepared = await prepareAny(source, w, h, progress);
        const lines = wantsLines(settings) ? await extractLines(prepared.subject, progress) : null;
        const dotted = render(prepared.subject, prepared.reduced, settings, lines);
        result = dotted.image;
        status = `AI 그림을 도트화 · ${dotStatus(settings, dotted)}`;
      }
      const final = picture(result);
      self.postMessage({ id: job.id, type: 'done', final, status }, [final.bytes.buffer]);
    }
  } catch (error) {
    console.error(error);
    const message = error instanceof DotError ? error.message : `${Errors.render} (${error.message})`;
    self.postMessage({ id: job.id, type: 'error', message, canSkip: Boolean(error.canSkip) });
  }
}

/** 원본 → (AI 업스케일) → 캐릭터 분리·축소·선 지도. raw는 처음 연 원본이고, AI 업스케일 설정이 바뀌면 여기서 다시 시작한다. */
async function load(raw, w, h, settings, progress, whole = false) {
  const wanted = upscaleModel(raw, settings.upscale, Math.max(w, h));
  const { image: original, upscaled, skipped } = await tryUpscale(raw, wanted, progress);
  let prepared;
  try {
    prepared = whole ? { ...prepare(original, w, h, null, false, true), masked: null } : await prepareAny(original, w, h, progress);
  } catch (error) {
    // 캐릭터 분리(배경 지우기)에서 막힌 것이면 화면이 '분리 없이 그대로 변환'을 권할 수 있게 알린다.
    error.canSkip = !whole;
    throw error;
  }
  const lines = wantsLines(settings) ? await extractLines(prepared.subject, progress) : null;
  return { raw, wanted, upscaled, skipped, original, masked: prepared.masked, subject: prepared.subject, reduced: prepared.reduced, lines, faithful: null, whole };
}

/** AI 업스케일이 실패해도(파일을 못 받음 등) 그림은 연다: 키우지 않은 원본으로 도트화하고 이유를 남긴다. */
async function tryUpscale(image, model, progress) {
  if (!model) return { image, upscaled: null, skipped: null };
  try {
    return { image: await upscaleImage(image, model, progress), upscaled: model, skipped: null };
  } catch (error) {
    console.error(error);
    return { image, upscaled: null, skipped: error instanceof DotError ? 'AI 파일을 준비하지 못함' : '실행 오류' };
  }
}

/** 선 추출 AI는 베리 잉크·2.0 방식에서만 쓴다(원본 색 살림은 원본 선을 그대로 쓴다). */
const wantsLines = settings => settings.aiLines && settings.method !== 'soft';

/** 캐릭터 분리 + 축소. 밝은 단색·투명 배경이 아니면 AI 모델로 배경을 지운다. */
async function prepareAny(image, w, h, progress) {
  try {
    return { ...prepare(image, w, h), masked: null };
  } catch (error) {
    if (error.code !== 'needsMask') throw error;
    const masked = await removeBackground(image, progress);
    return { ...prepare(image, w, h, masked), masked };
  }
}

let queue = Promise.resolve();
self.onmessage = event => { queue = queue.then(() => handle(event.data)); };
