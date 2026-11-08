// 작업자(Web Worker): 변환과 AI를 화면과 따로 돌려 처리 중에도 창이 멈추지 않게 한다.
// 일은 들어온 순서대로 하나씩 한다. 원본·캐릭터·선 지도는 여기 두고, 화면에는 결과 그림만 보낸다.
let current = null; // { original, masked, subject, reduced, lines, faithful }

const picture = raster => ({ w: raster.grid.w, h: raster.grid.h, bytes: raster.straightBytes() });

/** 원본 보존은 투명 그림의 떨어진 장식까지 살리고 원본에서 바로 격자를 읽어, 캐릭터·축소를 따로 둔다. */
function faithfulParts() {
  const { w, h } = current.reduced.image.grid;
  if (!current.faithful || current.faithful.w !== w || current.faithful.h !== h) {
    const subject = Subject.extract(current.original, current.masked, true);
    current.faithful = { w, h, subject, reduced: reduceDirect(subject, w, h) };
  }
  return current.faithful;
}

function finish(id, settings) {
  const parts = settings.method === 'faithful' ? faithfulParts() : current;
  const dotted = render(parts.subject, parts.reduced, settings, current.lines);
  const reduced = picture(parts.reduced.image), dot = picture(dotted.image);
  self.postMessage({ id, type: 'done', reduced, dotted: dot, status: dotStatus(settings, dotted) },
    [reduced.bytes.buffer, dot.bytes.buffer]);
}

async function handle(job) {
  const progress = label => self.postMessage({ id: job.id, type: 'progress', label });
  try {
    if (job.type === 'open') {
      const { original, w, h, settings } = job;
      const prepared = await prepareAny(original, w, h, progress);
      const lines = wantsLines(settings) ? await extractLines(prepared.subject, progress) : null;
      current = { original, masked: prepared.masked, subject: prepared.subject, reduced: prepared.reduced, lines, faithful: null };
      finish(job.id, settings);
    } else if (job.type === 'resize') {
      current = { ...current, reduced: reduce(current.subject, job.w, job.h) };
      finish(job.id, job.settings);
    } else if (job.type === 'redot') {
      if (wantsLines(job.settings) && !current.lines) current.lines = await extractLines(current.subject, progress);
      finish(job.id, job.settings);
    } else if (job.type === 'jev') {
      // JEV에 물을 항목(확대 그림·후보·바꿀 칸). 요청은 화면이 프로그램 본체를 거쳐 보낸다.
      const { subject, reduced } = faithfulParts();
      const now = Raster.fromStraight(job.current.bytes, job.current.w, job.current.h);
      self.postMessage({ id: job.id, type: 'done', ...jevProbes(subject, reduced, now, job.focus) });
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
        const prepared = await prepareAny(image, w, h, progress);
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
    self.postMessage({ id: job.id, type: 'error', message });
  }
}

/** 선 추출 AI는 베리 잉크·2.0 방식에서만 쓴다(원본 색 살림은 원본 선을 그대로 쓴다). */
const wantsLines = settings => settings.aiLines && settings.method !== 'soft';

/** 캐릭터 분리 + 축소. 밝은 단색·투명 배경이 아니면 맥판은 Vision으로, 웹 버전은 AI 모델로 배경을 지운다. */
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
