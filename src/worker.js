// 작업자(Web Worker): 변환과 AI를 화면과 따로 돌려 처리 중에도 창이 멈추지 않게 한다.
// 일은 들어온 순서대로 하나씩 한다. 원본·캐릭터·선 지도는 여기 두고, 화면에는 결과 그림만 보낸다.
let current = null; // { raw, wanted, upscaled, skipped, background, subject, faithful, whole, upscaleCache }
// 화면이 취소한 일 id. 일이 진행 단계(progress)를 알릴 때마다 보고 멈춘다.
const cancelled = new Set();
// 지금 열어 둔 그림(current)이 있어야 하는 일. 작업자를 새로 띄운 직후에는 current가 없다.
const NEEDS_CURRENT = new Set(['resize', 'redot', 'jev', 'jevStrokes', 'jevFills', 'jevRender', 'subject']);
const cancelError = () => Object.assign(new DotError('취소했습니다.'), { cancelled: true });

const picture = raster => ({ w: raster.grid.w, h: raster.grid.h, bytes: raster.straightBytes() });

/** 원본 보존은 투명 그림의 떨어진 장식까지 살리고 원본에서 바로 격자를 읽어, 캐릭터·축소를 따로 둔다. */
function faithfulParts() {
  const { w, h } = current;
  if (!current.faithful || current.faithful.w !== w || current.faithful.h !== h) {
    const subject = current.subject;
    current.faithful = { w, h, subject, reduced: reduceDirect(subject, w, h), candidates: new Map() };
  }
  return current.faithful;
}

/** 원본 보존에서 '격자 위치 맞추기'를 켜면 맞춘 격자를 쓴다(한 번 계산해 둔다). */
function reducedFor(parts, settings) {
  if (!(settings.gridPhase && settings.method === 'faithful')) return parts.reduced;
  parts.aligned ??= reduceAligned(parts.subject, parts.w, parts.h);
  return parts.aligned;
}

async function finish(id, settings, progress) {
  const parts = faithfulParts(), base = reducedFor(parts, settings);
  const dotted = await renderDot(parts.subject, base, settings, progress, parts.candidates);
  const reduced = picture(base.image), dot = picture(dotted.image);
  const sharpened = current.upscaled ? ` · AI 업스케일 ${current.upscaled === 'esr6b' ? '6B' : 'v3'}`
    : current.skipped ? ` · AI 업스케일 건너뜀(${current.skipped})` : ' · AI 업스케일 안 함';
  const background = current.whole ? ' · 배경 분리 없이 그대로' : current.aiBackground ? ' · AI 배경 분리' : '';
  self.postMessage({ id, type: 'done', reduced, dotted: dot, status: dotStatus(settings, dotted) + sharpened + background },
    [reduced.bytes.buffer, dot.bytes.buffer]);
}

async function handle(job) {
  const progress = label => {
    if (cancelled.has(job.id)) throw cancelError();
    self.postMessage({ id: job.id, type: 'progress', label });
  };
  // 끝난 뒤에 도착한 취소 표시는 남겨 둘 이유가 없다(id는 늘어나기만 한다).
  for (const id of cancelled) if (id < job.id) cancelled.delete(id);
  try {
    await gpuCheck;
    if (cancelled.has(job.id)) throw cancelError();
    if (!current && NEEDS_CURRENT.has(job.type)) throw new DotError('작업자를 다시 시작해 열어 둔 그림이 사라졌습니다. 그림을 다시 열어 주세요.');
    if (job.type === 'open') {
      const { original, w, h, settings } = job;
      current = await load(original, w, h, settings, progress, Boolean(job.whole));
      await finish(job.id, settings, progress);
    } else if (job.type === 'resize') {
      // 결과 크기가 바뀌면 '자동' AI 업스케일을 쓸지가 달라질 수 있다.
      if (needsReload(job.settings, job.w, job.h)) {
        current = await load(current.raw, job.w, job.h, job.settings, progress, keepManualBackground(job.settings));
      } else {
        if (current.w !== job.w || current.h !== job.h) {
          Object.assign(current, { w: job.w, h: job.h, jevStrokes: null });
        }
      }
      await finish(job.id, job.settings, progress);
    } else if (job.type === 'redot') {
      const { w, h } = current;
      if (needsReload(job.settings, w, h)) {
        current = await load(current.raw, w, h, job.settings, progress, keepManualBackground(job.settings));
      }
      await finish(job.id, job.settings, progress);
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
      if (!current.jevStrokes) throw new DotError('다시 비교해 주세요.');
      const fills = fillCandidates(current.jevStrokes[job.index], faithfulParts().reduced);
      self.postMessage({ id: job.id, type: 'done', candidates: fills.map(c => ({ label: c.label, picture: picture(c.image) })) });
    } else if (job.type === 'jevRender') {
      // JEV 자동 선택: 설정 후보마다 그린 결과
      const parts = faithfulParts(), results = [];
      for (const settings of job.list) {
        const base = reducedFor(parts, settings);
        const dotted = await renderDot(parts.subject, base, settings, progress, parts.candidates);
        results.push({ reduced: picture(base.image), dotted: picture(dotted.image), status: dotStatus(settings, dotted) });
      }
      self.postMessage({ id: job.id, type: 'done', results });
    } else if (job.type === 'subject') {
      // 클라우드 AI에 보낼 캐릭터 그림
      const subject = picture(current.subject);
      self.postMessage({ id: job.id, type: 'done', subject }, [subject.bytes.buffer]);
    } else if (job.type === 'cutout') {
      // 실험 탭: 받은 그림에서 배경만 지운 캐릭터를 돌려준다(지금 열어 둔 그림은 건드리지 않는다).
      const { image } = job;
      let subject;
      try {
        subject = Subject.extract(image, null, true);
      } catch (error) {
        if (error.code !== 'needsMask') throw error;
        subject = Subject.extract(image, await removeBackground(image, progress), true);
      }
      const cut = picture(subject);
      self.postMessage({ id: job.id, type: 'done', subject: cut }, [cut.bytes.buffer]);
    } else if (job.type === 'lab' || job.type === 'labBatch') {
      // 실험 탭: 받은 그림을 그 탭 설정으로 도트로 바꾼다(lab-core.js). 지금 열어 둔 그림은 건드리지 않는다.
      const result = labCompute(job.source, job.options);
      self.postMessage({ id: job.id, type: 'done', ...result }, [result.bytes.buffer]);
    } else if (job.type === 'lab2') {
      const region = job.rectangles ? lab2Region(job.source, job.rectangles) : job.options.region;
      const result = lab2Compute(job.source, { ...job.options, region });
      self.postMessage({ id: job.id, type: 'done', ...result }, [result.picture.bytes.buffer]);
    } else if (job.type === 'samSelect') {
      const mask = await samSelect(job.source, job.imageId, job.point, progress);
      self.postMessage({ id: job.id, type: 'done', mask }, [mask.buffer]);
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
        const { subject } = await prepareDotSubject(source, settings.background, progress);
        const reduced = settings.gridPhase && settings.method === 'faithful' ? reduceAligned(subject, w, h) : reduceDirect(subject, w, h);
        const dotted = await renderDot(subject, reduced, settings, progress);
        result = dotted.image;
        status = `AI 그림을 도트화 · ${dotStatus(settings, dotted)}`;
      }
      const final = picture(result);
      self.postMessage({ id: job.id, type: 'done', final, status }, [final.bytes.buffer]);
    }
  } catch (error) {
    if (error?.cancelled) { self.postMessage({ id: job.id, type: 'cancelled' }); return; }
    console.error(error);
    const message = error instanceof DotError ? error.message : `${Errors.render} (${error.message})`;
    self.postMessage({ id: job.id, type: 'error', message, canSkip: Boolean(error.canSkip) });
  } finally {
    cancelled.delete(job.id);
  }
}

/** 전처리 설정이 바뀌면 처음 연 원본부터 다시 처리한다. */
function needsReload(settings, w, h) {
  return settings.background !== current.background ||
    upscaleModel(current.raw, settings.upscale, Math.max(w, h)) !== current.wanted;
}

const keepManualBackground = settings => current.manualWhole && current.background === settings.background;

async function load(raw, w, h, settings, progress, manualWhole = false) {
  const wanted = upscaleModel(raw, settings.upscale, Math.max(w, h));
  // 배경 방식만 바꾼 경우처럼 원본·모델이 같으면 앞서 키운 그림을 다시 쓴다(ESRGAN은 오래 걸린다).
  const cache = current?.upscaleCache;
  const upscale = wanted && cache?.raw === raw && cache.model === wanted ? cache.result : await tryUpscale(raw, wanted, progress);
  const { image: original, upscaled, skipped } = upscale;
  let prepared;
  const whole = manualWhole || settings.background === 'keep';
  try {
    prepared = whole ? { subject: Subject.whole(original), aiBackground: false } : await prepareDotSubject(original, settings.background, progress);
  } catch (error) {
    // 캐릭터 분리(배경 지우기)에서 막힌 것이면 화면이 '분리 없이 그대로 변환'을 권할 수 있게 알린다.
    error.canSkip = !whole;
    throw error;
  }
  return { raw, wanted, upscaled, skipped, w, h, background: settings.background, ...prepared, faithful: null, whole, manualWhole,
    upscaleCache: upscaled ? { raw, model: wanted, result: upscale } : null };
}

/** AI 업스케일이 실패해도(파일을 못 받음 등) 그림은 연다: 키우지 않은 원본으로 도트화하고 이유를 남긴다. */
async function tryUpscale(image, model, progress) {
  if (!model) return { image, upscaled: null, skipped: null };
  try {
    return { image: await upscaleImage(image, model, progress), upscaled: model, skipped: null };
  } catch (error) {
    if (error?.cancelled) throw error;
    console.error(error);
    return { image, upscaled: null, skipped: error instanceof DotError ? 'AI 파일을 준비하지 못함' : '실행 오류' };
  }
}

/** 축소 방식에 앞서 공통으로 캐릭터를 분리한다. */
async function prepareDotSubject(image, background, progress) {
  if (background === 'keep') return { subject: Subject.whole(image), aiBackground: false };
  if (background === 'ai') {
    // 흰 몸통과 배경이 이어진 그림에서 밝은 배경 제거 규칙을 거치지 않는다.
    const masked = await removeBackground(image, progress);
    return { subject: Subject.extract(masked, null, true), aiBackground: true };
  }
  try {
    return { subject: Subject.extract(image, null, true), aiBackground: false };
  } catch (error) {
    if (error.code !== 'needsMask') throw error;
    const masked = await removeBackground(image, progress);
    return { subject: Subject.extract(image, masked, true), aiBackground: true };
  }
}

let queue = Promise.resolve();
self.onmessage = ({ data }) => {
  if (data.type === 'adaptive-native-response') receiveNativeAdaptive(data);
  // 취소는 줄을 서지 않고 바로 표시해야 돌고 있는 일이 다음 진행 단계에서 멈춘다.
  else if (data.type === 'cancel') cancelled.add(data.id);
  // 저장된 AI 파일을 지우면 메모리에 올려 둔 AI도 놓는다(돌고 있는 일이 끝난 뒤에).
  else if (data.type === 'clearAI') queue = queue.then(releaseAI);
  else queue = queue.then(() => handle(data));
};
