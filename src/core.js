// 도트메이커 변환 코어 — 맥판 2.9.0(Swift) 변환 코드를 그대로 옮긴 것.
// 브라우저와 Node(비교 시험) 양쪽에서 같은 코드가 돈다. 화면·파일 입출력은 여기 없다.
//
// 표현 방식
// - Pixel: 32비트 정수 하나 (r<<24 | g<<16 | b<<8 | a). 같음 비교는 정수 비교, 색 키는 p >>> 8.
// - Raster: 곧은(straight) 알파 픽셀 배열 { w, h, px: Uint32Array }
// - CGImage 대신: 프리멀티플라이 RGBA 바이트 { w, h, data: Uint8Array }
// - Swift Float(32비트) 계산은 Math.fround로 맞춘다.

export const F = Math.fround;

// ───────────────────────────── 오류
export class DotError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}
export const Errors = {
  read: '이미지를 읽을 수 없습니다.',
  render: '이미지를 처리할 수 없습니다.',
  subject: '캐릭터를 분리하지 못했습니다. 캐릭터 주위에 여백이 있는 원본이나 투명 PNG를 열어 주세요.',
  needsMask: 'AI 배경 분리가 필요한 이미지입니다.',
  dimensions: '가로와 세로를 각각 16~250px로 입력해 주세요.',
};
const fail = key => { throw new DotError(Errors[key], key); };

// ───────────────────────────── Pixel
export const pack = (r, g, b, a = 255) => ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
export const R = p => p >>> 24;
export const G = p => (p >>> 16) & 255;
export const B = p => (p >>> 8) & 255;
export const A = p => p & 255;
export const KEY = p => p >>> 8;
export const CLEAR = 0;
export const BLACK = pack(0, 0, 0);
const withAlpha = (p, a) => ((p & 0xffffff00) | a) >>> 0;
export const light = p => Math.floor((54 * R(p) + 183 * G(p) + 19 * B(p)) / 256);
export const chroma = p => Math.max(R(p), G(p), B(p)) - Math.min(R(p), G(p), B(p));
export const pink = p => { const r = R(p), g = G(p), b = B(p); return r >= 135 && r - g >= 20 && b - g >= 7 && b <= r; };
export const paper = p => light(p) >= 205 && chroma(p) <= 24;
export function distance(p, q) {
  const dr = R(p) - R(q), dg = G(p) - G(q), db = B(p) - B(q);
  return dr * dr + dg * dg * 2 + db * db;
}
export function mixed(p, q, percent) {
  const mix = (a, b) => Math.floor((a * (100 - percent) + b * percent + 50) / 100);
  return pack(mix(R(p), R(q)), mix(G(p), G(q)), mix(B(p), B(q)));
}
const keyPixel = k => pack((k >>> 16) & 255, (k >>> 8) & 255, k & 255);

/** Swift .rounded() (반올림, 0에서 먼 쪽) */
export const roundAway = x => (x < 0 ? -Math.round(-x) : Math.round(x));

/** Swift Dictionary.max/min 대신: 값 배열에서 처음 나온 최댓값 (동점은 먼저 넣은 것) */
function firstMax(items, less) {
  let best;
  for (const item of items) if (best === undefined || less(best, item)) best = item;
  return best;
}
function firstMin(items, less) {
  let best;
  for (const item of items) if (best === undefined || less(item, best)) best = item;
  return best;
}

// ───────────────────────────── Grid
export class Grid {
  constructor(w, h) { this.w = w; this.h = h; this.count = w * h; }
  each4(i, visit) {
    const x = i % this.w;
    if (x > 0) visit(i - 1);
    if (x + 1 < this.w) visit(i + 1);
    if (i >= this.w) visit(i - this.w);
    if (i + this.w < this.count) visit(i + this.w);
  }
  each8(i, visit) {
    const w = this.w, x = i % w, y = (i / w) | 0;
    const y0 = Math.max(0, y - 1), y1 = Math.min(this.h - 1, y + 1);
    const x0 = Math.max(0, x - 1), x1 = Math.min(w - 1, x + 1);
    for (let v = y0; v <= y1; v++) for (let u = x0; u <= x1; u++) if (u !== x || v !== y) visit(v * w + u);
  }
  edge(i) { const w = this.w; return i < w || i >= this.count - w || i % w === 0 || i % w === w - 1; }
  components(mask, diagonal = true) {
    const seen = Uint8Array.from(mask, Boolean);
    const result = [];
    for (let i = 0; i < seen.length; i++) {
      if (!seen[i]) continue;
      const component = [i];
      seen[i] = 0;
      const add = j => { if (seen[j]) { seen[j] = 0; component.push(j); } };
      for (let next = 0; next < component.length; next++) {
        if (diagonal) this.each8(component[next], add); else this.each4(component[next], add);
      }
      result.push(component);
    }
    return result;
  }
  /** 투명 칸에서 몇 걸음 떨어졌는지(상하좌우). 캔버스 가장자리도 바깥으로 본다. */
  depths(mask) {
    const depth = new Int32Array(this.count);
    const queue = [];
    for (let i = 0; i < this.count; i++) {
      if (!mask[i]) continue;
      let edge = this.edge(i);
      this.each4(i, j => { if (!mask[j]) edge = true; });
      if (edge) { depth[i] = 1; queue.push(i); }
    }
    for (let next = 0; next < queue.length; next++) {
      const i = queue[next];
      this.each4(i, j => { if (mask[j] && depth[j] === 0) { depth[j] = depth[i] + 1; queue.push(j); } });
    }
    return depth;
  }
}

const largest = list => firstMax(list, (a, b) => a.length < b.length) ?? [];

// ───────────────────────────── Raster / 이미지(프리멀티플라이 바이트)
export class Raster {
  constructor(w, h, px = new Uint32Array(w * h)) { this.grid = new Grid(w, h); this.px = px; }
  clone() { return new Raster(this.grid.w, this.grid.h, this.px.slice()); }
  /** CGImage 만들기와 같은 프리멀티플라이 */
  image() {
    const n = this.px.length, data = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      const p = this.px[i], a = A(p);
      data[i * 4] = Math.floor((R(p) * a + 127) / 255);
      data[i * 4 + 1] = Math.floor((G(p) * a + 127) / 255);
      data[i * 4 + 2] = Math.floor((B(p) * a + 127) / 255);
      data[i * 4 + 3] = a;
    }
    return { w: this.grid.w, h: this.grid.h, data };
  }
  /** Raster(CGImage, width:, height:) — 항상 고품질 보간 */
  static from(image, width = image.w, height = image.h) {
    const drawn = draw(image, width, height, { x: 0, y: 0, w: width, h: height }, false);
    return Raster.fromPremultiplied(drawn, width, height);
  }
  static fromPremultiplied(data, w, h) {
    const px = new Uint32Array(w * h);
    for (let i = 0; i < px.length; i++) {
      const o = i * 4, a = data[o + 3];
      if (a === 0) continue;
      const s = c => Math.min(255, Math.floor((c * 255 + (a >> 1)) / a));
      px[i] = pack(s(data[o]), s(data[o + 1]), s(data[o + 2]), a);
    }
    return new Raster(w, h, px);
  }
  /** 곧은 알파 RGBA 바이트(캔버스 ImageData)에서 */
  static fromStraight(bytes, w, h) {
    const px = new Uint32Array(w * h);
    for (let i = 0; i < px.length; i++) {
      const o = i * 4;
      if (bytes[o + 3] === 0) continue;
      px[i] = pack(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
    }
    return new Raster(w, h, px);
  }
  straightBytes() {
    const out = new Uint8ClampedArray(this.px.length * 4);
    for (let i = 0; i < this.px.length; i++) {
      const p = this.px[i];
      out[i * 4] = R(p); out[i * 4 + 1] = G(p); out[i * 4 + 2] = B(p); out[i * 4 + 3] = A(p);
    }
    return out;
  }
  /** 정수배 확대: 한 픽셀을 k×k 칸으로 그대로 늘린다(번짐 없음). */
  scaled(k) {
    if (k <= 1) return this;
    const w = this.grid.w * k, h = this.grid.h * k, out = new Raster(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.px[y * w + x] = this.px[((y / k) | 0) * this.grid.w + ((x / k) | 0)];
    return out;
  }
  crop(x, y, w, h) {
    const out = new Raster(w, h);
    for (let v = 0; v < h; v++) out.px.set(this.px.subarray((v + y) * this.grid.w + x, (v + y) * this.grid.w + x + w), v * w);
    return out;
  }
}

// ── 그리기(Core Graphics 흉내)
// 줄일 때는 Catmull-Rom, 늘릴 때는 쌍선형(맥 고품질 보간과 가장 가까웠던 방식, tools/resample-study.mjs).
// legacy=true(PixelConverter.rasterize)는 5% 넘게 늘릴 때 보간 없이 가장 가까운 픽셀을 쓴다.
const catmull = x => { x = Math.abs(x); return x < 1 ? 1.5 * x * x * x - 2.5 * x * x + 1 : x < 2 ? -0.5 * x * x * x + 2.5 * x * x - 4 * x + 2 : 0; };
const triangle = x => Math.max(0, 1 - Math.abs(x));

function filterWeights(src, dst) {
  const scale = dst / src;
  const [kernel, support0] = scale < 1 ? [catmull, 2] : [triangle, 1];
  const fs = scale < 1 ? 1 / scale : 1, support = support0 * fs;
  const out = [];
  for (let i = 0; i < dst; i++) {
    const center = (i + 0.5) / scale;
    const lo = Math.max(0, Math.floor(center - support)), hi = Math.min(src - 1, Math.ceil(center + support));
    const ws = new Float64Array(hi - lo + 1);
    let sum = 0;
    for (let j = lo; j <= hi; j++) { const w = kernel((j + 0.5 - center) / fs); ws[j - lo] = w; sum += w; }
    for (let k = 0; k < ws.length; k++) ws[k] /= sum;
    out.push({ lo, ws });
  }
  return out;
}

function resampleSmooth(image, dw, dh) {
  const { w: sw, h: sh, data } = image;
  if (dw === sw && dh === sh) return data.slice();
  const wx = filterWeights(sw, dw), wy = filterWeights(sh, dh);
  const tmp = new Float64Array(dw * sh * 4);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < dw; x++) {
      const { lo, ws } = wx[x];
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < ws.length; k++) {
        const o = (y * sw + lo + k) * 4, w = ws[k];
        r += w * data[o]; g += w * data[o + 1]; b += w * data[o + 2]; a += w * data[o + 3];
      }
      const t = (y * dw + x) * 4;
      tmp[t] = r; tmp[t + 1] = g; tmp[t + 2] = b; tmp[t + 3] = a;
    }
  }
  const out = new Uint8Array(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const { lo, ws } = wy[y];
    for (let x = 0; x < dw; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < ws.length; k++) {
        const o = ((lo + k) * dw + x) * 4, w = ws[k];
        r += w * tmp[o]; g += w * tmp[o + 1]; b += w * tmp[o + 2]; a += w * tmp[o + 3];
      }
      const t = (y * dw + x) * 4;
      const al = Math.min(255, Math.max(0, Math.round(a)));
      out[t] = Math.min(al, Math.max(0, Math.round(r)));
      out[t + 1] = Math.min(al, Math.max(0, Math.round(g)));
      out[t + 2] = Math.min(al, Math.max(0, Math.round(b)));
      out[t + 3] = al;
    }
  }
  return out;
}

function resampleNearest(image, dw, dh) {
  const { w: sw, h: sh, data } = image, out = new Uint8Array(dw * dh * 4);
  const xs = new Int32Array(dw);
  for (let x = 0; x < dw; x++) xs[x] = Math.min(sw - 1, Math.floor((x + 0.5) * sw / dw));
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.floor((y + 0.5) * sh / dh));
    for (let x = 0; x < dw; x++) {
      const s = (sy * sw + xs[x]) * 4, t = (y * dw + x) * 4;
      out[t] = data[s]; out[t + 1] = data[s + 1]; out[t + 2] = data[s + 2]; out[t + 3] = data[s + 3];
    }
  }
  return out;
}

/**
 * width×height 투명 캔버스에 image를 rect(CG 좌표: 왼쪽 아래 원점)에 그린 프리멀티플라이 바이트.
 * rect의 x·y·w·h는 정수만 쓴다.
 */
export function draw(image, width, height, rect, legacy) {
  const out = new Uint8Array(width * height * 4);
  if (!image) return out;
  const upscaling = rect.w > image.w * 1.05 || rect.h > image.h * 1.05;
  const scaled = legacy && upscaling ? resampleNearest(image, rect.w, rect.h) : resampleSmooth(image, rect.w, rect.h);
  const top = height - (rect.y + rect.h);
  for (let v = 0; v < rect.h; v++) {
    const y = top + v;
    if (y < 0 || y >= height) continue;
    for (let u = 0; u < rect.w; u++) {
      const x = rect.x + u;
      if (x < 0 || x >= width) continue;
      const s = (v * rect.w + u) * 4, t = (y * width + x) * 4;
      out[t] = scaled[s]; out[t + 1] = scaled[s + 1]; out[t + 2] = scaled[s + 2]; out[t + 3] = scaled[s + 3];
    }
  }
  return out;
}

/** 원본 크기를 한 변 2048px 이하로 (CGImageSourceCreateThumbnail 대신) */
export function limitSize(image, max = 2048) {
  const big = Math.max(image.w, image.h);
  if (big <= max) return image;
  const s = max / big, w = Math.max(1, Math.round(image.w * s)), h = Math.max(1, Math.round(image.h * s));
  return { w, h, data: draw(image, w, h, { x: 0, y: 0, w, h }, false) };
}

// ───────────────────────────── Subject (배경 지우고 캐릭터만)
export const Subject = {
  /** masked: 배경을 AI로 지운 같은 크기 이미지. 맥판의 Vision 대신 쓰고, 밝은 배경·투명 배경이 아닐 때만 필요하다. */
  extract(source, masked = null, keepTransparentArt = false) {
    let raster = Raster.from(source);
    const grid = raster.grid;
    let hasBackgroundAlpha = false;
    for (let i = 0; i < grid.count; i++) if (grid.edge(i) && A(raster.px[i]) < 32) { hasBackgroundAlpha = true; break; }
    // 원본 보존: 투명 배경 그림은 떨어진 장식까지 그대로 둔다(거의 안 보이는 알파 1 바닥만 지움).
    if (keepTransparentArt && hasBackgroundAlpha) {
      for (let i = 0; i < grid.count; i++) if (A(raster.px[i]) === 1) raster.px[i] = CLEAR;
      return cropVisible(raster);
    }
    const removed = removePaleBackdrop(raster);
    if (!removed && !hasBackgroundAlpha) {
      if (!masked) fail('needsMask');
      raster = Raster.from(masked);
    }

    const components = grid.components(Array.from(raster.px, p => A(p) >= 48));
    const main = largest(components);
    if (main.length < 4) fail('subject');
    const keep = new Uint8Array(grid.count);
    for (const i of main) {
      keep[i] = 1;
      grid.each8(i, j => { if (A(raster.px[j]) < 48) keep[j] = 1; });
    }
    for (let i = 0; i < grid.count; i++) if (!keep[i]) raster.px[i] = CLEAR;
    return cropVisible(raster);
  },
  /** 분리 없이: 배경을 지우지 않고 그림 전체를 그대로 쓴다(캐릭터를 분리하지 못했을 때 사용자가 고름). */
  whole(source) {
    return cropVisible(Raster.from(source));
  },
};

function cropVisible(raster) {
  const grid = raster.grid;
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let i = 0; i < grid.count; i++) {
    if (A(raster.px[i]) === 0) continue;
    const x = i % grid.w, y = (i / grid.w) | 0;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  if (x1 < 0) fail('subject');
  return raster.crop(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
}

function removePaleBackdrop(raster) {
  const grid = raster.grid, px = raster.px;
  const pale = Array.from(px, p => light(p) >= 185 && chroma(p) <= 34);
  let edgeCount = 0;
  const queue = [];
  for (let i = 0; i < grid.count; i++) if (grid.edge(i)) { edgeCount++; if (pale[i]) queue.push(i); }
  if (!(queue.length * 5 >= edgeCount * 4)) return false;
  const background = new Uint8Array(grid.count);
  for (const i of queue) background[i] = 1;
  for (let next = 0; next < queue.length; next++) {
    grid.each4(queue[next], j => { if (pale[j] && !background[j]) { background[j] = 1; queue.push(j); } });
  }
  if (!(queue.length > Math.floor(grid.count / 12))) return false;
  const original = px.slice();
  for (let i = 0; i < grid.count; i++) {
    if (background[i]) { px[i] = CLEAR; continue; }
    const o = original[i];
    if (light(o) > 95 && chroma(o) < 40) {
      let touches = false, darkest = o;
      grid.each8(i, j => {
        if (background[j]) touches = true;
        else if (light(original[j]) < light(darkest)) darkest = original[j];
      });
      if (touches && light(darkest) < 65) px[i] = mixed(o, darkest, 65);
    }
  }
  return true;
}

// ───────────────────────────── 칸 색 평균
class Acc {
  constructor() { this.r = 0; this.g = 0; this.b = 0; this.weight = 0; }
  add(p, area = 1) { const a = A(p) * area; this.r += R(p) * a; this.g += G(p) * a; this.b += B(p) * a; this.weight += a; }
  get color() {
    if (this.weight <= 0) return BLACK;
    return pack(Math.floor(this.r / this.weight), Math.floor(this.g / this.weight), Math.floor(this.b / this.weight));
  }
}


// ───────────────────────────── 도트화 방식과 설정
export const DOT_METHODS = [
  ['faithful', '원본 보존'],
  ['dpid', 'DPID'],
  ['ssim', 'SSIM 축소'],
  ['adaptive', '내용 적응형 축소'],
  ['mks', 'Magic Kernel Sharp'],
];
export const dotMethodName = method => DOT_METHODS.find(([id]) => id === method)?.[1];

// boundary·transparency·colors·cleanup은 JEV 채색 후보(ColorReducer)가 쓴다.
export const defaultSettings = () => ({ boundary: true, transparency: 80, colors: 12, cleanup: 1, method: 'faithful', crispOutline: false, cleanBlends: false, snapColors: false, preserveMouth: false, upscale: 'auto', background: 'auto',
  sharpCells: false, hardEdge: false, outlineStack: 0, lonePixels: false, palette: 'off', paletteCustom: '',
  autoColors: 0, pixelPerfect: false, gridPhase: false });

// ───────────────────────────── 색 줄이기
export const ColorReducer = {
  count(image) { const s = new Set(); for (const p of image.px) if (A(p) > 0) s.add(KEY(p)); return s.size; },

  /** keep: 건드리지 않을 칸(JEV 채색 후보에서 선·반투명 칸 보호, 맥판 preserving과 같음) */
  apply(source, outline, boundary, settings, keep = null) {
    const limit = Math.max(6, Math.min(32, settings.colors));
    const image = source.clone();
    const px = image.px;
    const visible = [];
    for (let i = 0; i < px.length; i++) if (A(px[i]) > 0 && !keep?.[i]) visible.push(i);
    if (visible.length === 0) return image;
    const histogram = new Map();
    for (const i of visible) if (!outline[i] && !boundary[i]) histogram.set(KEY(px[i]), (histogram.get(KEY(px[i])) ?? 0) + 1);
    const samples = [...histogram].sort((a, b) => a[0] - b[0]).map(([k, weight]) => ({ color: keyPixel(k), weight }));
    const paperColor = firstMax(samples.filter(s => paper(s.color)),
      (a, b) => (a.weight === b.weight ? light(a.color) < light(b.color) : a.weight < b.weight))?.color;
    const palette = [BLACK];
    if (paperColor !== undefined) palette.push(paperColor);
    const hasRim = settings.boundary && visible.some(i => boundary[i]);
    let rim;
    if (hasRim && paperColor !== undefined) {
      const middle = mixed(paperColor, BLACK, 50);
      rim = mixed(paperColor, middle, 100 - settings.transparency);
      if (!palette.includes(rim)) palette.push(rim);
    }
    const rimIndex = rim === undefined ? -1 : palette.indexOf(rim);
    const interiorPalette = palette.filter((c, index) => index !== rimIndex || c === paperColor || c === BLACK);
    const fixedCount = palette.length;
    for (let family = 1; family <= 3 && palette.length < limit; family++) {
      const sample = firstMax(samples.filter(s => category(s.color) === family), (a, b) => a.weight < b.weight);
      if (sample && !palette.includes(sample.color)) palette.push(sample.color);
    }
    while (palette.length < limit) {
      const imp = s => distance(s.color, palette[nearest(s.color, palette)]) * Math.sqrt(s.weight);
      const next = firstMax(samples, (a, b) => imp(a) < imp(b));
      if (!next || palette.includes(next.color)) break;
      palette.push(next.color);
    }
    const interiorIndices = palette.map((_, i) => i).filter(i => i !== rimIndex || palette[i] === paperColor || palette[i] === BLACK);
    for (let round = 0; round < 5; round++) {
      const allowed = interiorIndices.map(i => palette[i]);
      const groups = palette.map(() => []);
      samples.forEach((s, i) => groups[interiorIndices[nearest(s.color, allowed)]].push(i));
      let changed = false;
      for (let group = fixedCount; group < palette.length; group++) {
        if (groups[group].length === 0) continue;
        let r = 0, g = 0, b = 0, weight = 0;
        for (const i of groups[group]) {
          const it = samples[i];
          r += R(it.color) * it.weight; g += G(it.color) * it.weight; b += B(it.color) * it.weight; weight += it.weight;
        }
        const mean = pack(Math.floor(r / weight), Math.floor(g / weight), Math.floor(b / weight));
        const best = firstMin(groups[group], (x, y) => distance(samples[x].color, mean) < distance(samples[y].color, mean));
        const color = samples[best].color;
        changed = changed || color !== palette[group];
        palette[group] = color;
      }
      if (!changed) break;
    }
    const fillPalette = interiorPalette.concat(palette.slice(fixedCount));
    const mapping = new Map();
    for (const s of samples) {
      const c = s.color;
      if (paperColor !== undefined && light(c) >= 195 && chroma(c) <= 24) mapping.set(KEY(c), paperColor);
      else mapping.set(KEY(c), fillPalette[nearest(c, fillPalette)]);
    }
    for (const i of visible) {
      const old = px[i];
      let color;
      if (outline[i]) color = BLACK;
      else if (boundary[i] && rim !== undefined) color = rim;
      else color = mapping.get(KEY(old)) ?? fillPalette[nearest(old, fillPalette)];
      px[i] = withAlpha(color, A(old));
    }
    if (!(settings.cleanup > 0)) return image;
    const mapped = px.slice();
    const tolerance = settings.cleanup === 1 ? 1600 : 3600;
    for (const i of visible) {
      if (outline[i] || boundary[i] || !(light(mapped[i]) > 110)) continue;
      const neighbors = new Map();
      image.grid.each8(i, j => {
        const p = mapped[j];
        if (A(p) > 0 && !keep?.[j] && !outline[j] && !boundary[j] && category(p) === category(mapped[i])) neighbors.set(KEY(p), (neighbors.get(KEY(p)) ?? 0) + 1);
      });
      const own = neighbors.get(KEY(mapped[i])) ?? 0;
      if (!(own <= settings.cleanup)) continue;
      const majority = [...neighbors].sort((a, b) => (a[1] === b[1] ? a[0] - b[0] : b[1] - a[1]))[0];
      if (!majority || majority[1] < 5) continue;
      const color = palette.find(c => KEY(c) === majority[0]);
      if (color === undefined || distance(color, mapped[i]) > tolerance) continue;
      px[i] = withAlpha(color, A(mapped[i]));
    }
    return image;
  },
};

function nearest(color, palette) {
  const family = category(color);
  const same = [];
  for (let i = 0; i < palette.length; i++) if (category(palette[i]) === family && light(palette[i]) > 105) same.push(i);
  let choices;
  if (light(color) > 110 && same.length > 0) {
    choices = same;
    for (let i = 0; i < palette.length; i++) if (palette[i] === BLACK) choices.push(i);
  } else choices = palette.map((_, i) => i);
  return firstMin(choices, (a, b) => distance(color, palette[a]) < distance(color, palette[b]));
}
function category(c) {
  if (chroma(c) <= 12 || paper(c)) return 0;
  if (pink(c)) return 1;
  if (B(c) > G(c) && B(c) >= R(c) - 12) return 2;
  return 3;
}

// ───────────────────────────── 선·얼룩 정리
function countVotes(map, key, p) { const v = map.get(key); if (v) v[0]++; else map.set(key, [1, p]); }

export const LineCleanup = {
  isInk: p => A(p) > 0 && light(p) < 70 && chroma(p) < 60,

  apply(raster, mask, outline, width) {
    thinInk(raster, mask, outline, width);
    removeSpecks(raster, mask, outline);
  },

  /** 참·거짓 지도를 1픽셀 뼈대로 줄인다(Zhang-Suen). */
  skeletonize(on, grid) { zhangSuen(on, grid, null); },
};

function zhangSuen(on, grid, keep) {
  const w = grid.w, h = grid.h;
  const at = (x, y) => x >= 0 && y >= 0 && x < w && y < h && on[y * w + x];
  const removed = [];
  let changed = true;
  const n = new Array(8);
  while (changed) {
    changed = false;
    for (let pass = 0; pass < 2; pass++) {
      const drop = [];
      for (let i = 0; i < on.length; i++) {
        if (!on[i] || (keep && keep[i])) continue;
        const x = i % w, y = (i / w) | 0;
        n[0] = at(x, y - 1); n[1] = at(x + 1, y - 1); n[2] = at(x + 1, y); n[3] = at(x + 1, y + 1);
        n[4] = at(x, y + 1); n[5] = at(x - 1, y + 1); n[6] = at(x - 1, y); n[7] = at(x - 1, y - 1);
        let count = 0;
        for (let k = 0; k < 8; k++) if (n[k]) count++;
        if (count < 2 || count > 6) continue;
        let transitions = 0;
        for (let k = 0; k < 8; k++) if (!n[k] && n[(k + 1) % 8]) transitions++;
        if (transitions !== 1) continue;
        const ok = pass === 0 ? !(n[0] && n[2] && n[4]) && !(n[2] && n[4] && n[6])
          : !(n[0] && n[2] && n[6]) && !(n[0] && n[4] && n[6]);
        if (ok) drop.push(i);
      }
      for (const i of drop) on[i] = false;
      removed.push(...drop);
      if (drop.length) changed = true;
    }
  }
  return removed;
}

function thinInk(raster, mask, outline, width) {
  const grid = raster.grid, isInk = LineCleanup.isInk;
  const line = mask.map((m, i) => m && (outline[i] || isInk(raster.px[i])));
  const depth = grid.depths(mask);
  const keep = mask.map((_, i) => outline[i] || depth[i] > width + 2);
  const removed = zhangSuen(line, grid, keep);
  for (const i of removed) {
    const fill = commonNeighbor(raster, i, mask, j => line[j] || isInk(raster.px[j]));
    if (fill !== undefined) raster.px[i] = fill; else line[i] = true;
  }
}

function removeSpecks(raster, mask, outline) {
  const grid = raster.grid, before = raster.px.slice(), isInk = LineCleanup.isInk;
  for (let i = 0; i < grid.count; i++) {
    if (!mask[i] || outline[i] || isInk(before[i])) continue;
    let opaque = true, alone = true;
    grid.each8(i, j => { if (!mask[j]) opaque = false; if (before[j] === before[i]) alone = false; });
    if (!opaque || !alone || grid.edge(i)) continue;
    const counts = new Map();
    grid.each8(i, j => { const p = before[j]; if (!outline[j] && !isInk(p)) countVotes(counts, KEY(p), p); });
    const best = firstMax(counts.values(), (a, b) => a[0] < b[0]);
    if (!best || best[0] < 4 || !(distance(best[1], before[i]) < 3000)) continue;
    raster.px[i] = best[1];
  }
}

function commonNeighbor(raster, i, mask, skip) {
  const counts = new Map();
  raster.grid.each8(i, j => { if (mask[j] && !skip(j)) countVotes(counts, KEY(raster.px[j]), raster.px[j]); });
  return firstMax(counts.values(), (a, b) => a[0] < b[0])?.[1];
}

// ───────────────────────────── 볼터치 살리기
export const FaceDetail = {
  apply(raster, mask) { deepenBlush(raster, mask, findEyes(raster, mask)); },
  /** 작은 입선 보존: 눈 두 개 사이 아래의 작은 어두운 선(입)을, 칸마다 원본 선 색으로 살린다(맥판과 같음). */
  preserveMouth(raster, reduced) {
    const grid = raster.grid, w = grid.w, cells = reduced.cells;
    const eyes = findEyes(reduced.image, cells.map(c => c.cover >= 220)).sort((a, b) => a.minX - b.minX);
    if (eyes.length !== 2) return;
    const [left, right] = eyes;
    const x0 = left.maxX + 2, x1 = right.minX - 2;
    const bottom = Math.trunc((left.maxY + right.maxY) / 2);
    const height = Math.max(2, Math.min(left.maxY - left.minY, right.maxY - right.minY));
    const y0 = Math.max(1, bottom - Math.trunc(height / 3)), y1 = Math.min(grid.h - 2, bottom + Math.trunc(height * 2 / 3));
    if (!(x1 - x0 >= 3 && y0 <= y1)) return;
    const candidates = cells.map((c, i) => {
      const x = i % w, y = Math.floor(i / w);
      return x >= x0 && x <= x1 && y >= y0 && y <= y1 && c.cover >= 220 && c.dark >= 20 && light(c.ink) < 85 &&
        (c.dark >= 85 || light(c.fill) >= 180);
    });
    const pieces = grid.components(candidates).filter(piece => {
      if (piece.length < 3) return false;
      const xs = piece.map(i => i % w), ys = piece.map(i => Math.floor(i / w));
      return Math.max(...xs) - Math.min(...xs) >= 2 && Math.max(...ys) - Math.min(...ys) <= Math.trunc(height / 2)
        && Math.min(...ys) > y0 && Math.max(...ys) < y1;
    });
    if (pieces.length !== 1) return;
    const columns = new Map();
    for (const i of pieces[0]) {
      const best = columns.get(i % w);
      if (best === undefined || cells[i].dark > cells[best].dark) columns.set(i % w, i);
    }
    for (const i of columns.values()) raster.px[i] = withAlpha(cells[i].ink, A(raster.px[i]));
  },
};
const isEye = p => A(p) > 0 && !LineCleanup.isInk(p) && chroma(p) > 24 && B(p) > G(p) && B(p) >= R(p) - 12;

function findEyes(raster, mask) {
  const grid = raster.grid, w = grid.w;
  const pieces = grid.components(mask.map((m, i) => m && isEye(raster.px[i]))).filter(p => p.length >= 12 && p.length <= 260);
  const center = piece => [piece.reduce((s, i) => s + i % w, 0) / piece.length, piece.reduce((s, i) => s + Math.floor(i / w), 0) / piece.length];
  let best = null;
  for (let a = 0; a < pieces.length; a++) {
    for (let b = a + 1; b < pieces.length; b++) {
      const p = pieces[a], q = pieces[b], cp = center(p), cq = center(q);
      const sizeGap = Math.abs(p.length - q.length) / Math.max(p.length, q.length);
      const apart = Math.abs(cp[0] - cq[0]) >= Math.max(8, Math.sqrt(Math.min(p.length, q.length)) * 1.5);
      if (!(sizeGap < 0.6 && Math.abs(cp[1] - cq[1]) < 9 && apart)) continue;
      const smaller = Math.min(p.length, q.length);
      if (smaller > (best?.[0] ?? 0)) best = [smaller, p, q];
    }
  }
  if (!best) return [];
  return [best[1], best[2]].map(eye => {
    const xs = eye.map(i => i % w), ys = eye.map(i => Math.floor(i / w));
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  });
}

function deepenBlush(raster, mask, eyes) {
  if (eyes.length === 0) return;
  const grid = raster.grid, w = grid.w;
  const region = new Uint8Array(grid.count);
  for (const eye of eyes) {
    const ew = eye.maxX - eye.minX + 1, eh = eye.maxY - eye.minY + 1;
    const ya = Math.max(0, eye.maxY - Math.trunc(eh / 3)), yb = Math.min(grid.h - 1, eye.maxY + eh + Math.trunc(eh / 2));
    const xa = Math.max(0, eye.minX - Math.trunc(ew / 2)), xb = Math.min(w - 1, eye.maxX + Math.trunc(ew / 2));
    for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) region[y * w + x] = 1;
  }
  const pinkish = p => A(p) > 0 && light(p) >= 185 && chroma(p) >= 12 && chroma(p) <= 70 && R(p) > G(p) && R(p) >= B(p) && !paper(p);
  const counts = new Map();
  for (let i = 0; i < grid.count; i++) if (region[i] && mask[i] && pinkish(raster.px[i])) countVotes(counts, KEY(raster.px[i]), raster.px[i]);
  const best = firstMax(counts.values(), (a, b) => a[0] < b[0]);
  if (!best || best[0] < 4) return;
  const blush = best[1], deeper = saturated(blush, 1.9);
  for (let i = 0; i < grid.count; i++) if (raster.px[i] === blush) raster.px[i] = deeper;
}

function saturated(p, factor) {
  const maxC = Math.max(R(p), G(p), B(p)), minC = Math.min(R(p), G(p), B(p));
  if (!(maxC > 0)) return p;
  const s = Math.min(0.45, (maxC - minC) / maxC * factor);
  const channel = c => {
    const t = maxC === minC ? 0 : (maxC - c) / (maxC - minC);
    return Math.max(0, Math.min(255, roundAway(maxC - t * s * maxC)));
  };
  return pack(channel(R(p)), channel(G(p)), channel(B(p)), A(p));
}

// ───────────────────────────── 또렷하게
/**
 * 또렷하게(원본 보존): 칸 색을 평균 내지 않고 선 색(ink)이나 면 색(fill) 하나로 고른다.
 * 작은 결과 크기에서 눈·입·무늬가 회색으로 뭉개지는 것을 줄인다.
 * - 둘레(3×3)보다 뚜렷이 어둡고 양옆(또는 위아래)보다 진한 줄기 칸 → 선 (밝은 바탕의 가는 선)
 * - 둘레보다 뚜렷이 밝고 양옆(또는 위아래)보다 옅은 골 칸 → 면 (어두운 바탕의 밝은 무늬)
 * - 그 밖에는 어두운 쪽이 절반을 넘으면 선, 아니면 면
 * 안쪽 선은 칸을 차지한 만큼만 진하게, 바깥 테두리 선은 진하고 끊기지 않게 그린다.
 */
export function sharpCells(reduced) {
  const input = reduced.image, w = input.grid.w, h = input.grid.h, cells = reduced.cells, output = input.clone();
  const covered = (x, y) => x >= 0 && y >= 0 && x < w && y < h && cells[y * w + x].cover > 0;
  const dark = (x, y, other) => (covered(x, y) ? cells[y * w + x].dark : other);
  const lines = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, cell = cells[i];
    if (!(cell.cover > 0)) continue;
    const d = cell.dark;
    let sum = 0, count = 0;
    for (let v = -1; v <= 1; v++) for (let u = -1; u <= 1; u++) if (covered(x + u, y + v)) { sum += cells[(y + v) * w + x + u].dark; count++; }
    // 바깥 테두리 칸: 둘레에 빈 칸이 있다. 빈 칸은 '어둡지 않은 칸'으로 쳐야 테두리 선이 주변 선 칸에 묻혀 끊기지 않는다.
    const rim = count < 9;
    const around = sum / count, aroundOpen = sum / 9;
    const ridge = (d > dark(x - 1, y, 0) && d >= dark(x + 1, y, 0)) || (d > dark(x, y - 1, 0) && d >= dark(x, y + 1, 0));
    const valley = (d < dark(x - 1, y, 100) && d <= dark(x + 1, y, 100)) || (d < dark(x, y - 1, 100) && d <= dark(x, y + 1, 100));
    const thin = d < 50 && ridge && d >= 14 && d - aroundOpen >= 4;
    const line = d >= 86 ? true : d <= 6 ? false
      : thin ? true
      : valley && d <= 86 && around - d >= 4 ? false
      : d >= 50;
    // 안쪽 선은 칸을 차지한 만큼만 진하게(선 색을 면 색에 섞어) 그려 작은 크기에서 선이 그림을 덮지 않게 하고, 바깥 테두리 선은 진하게 둔다.
    const color = !line ? cell.fill : !rim && d < 86 ? mixed(cell.fill, cell.ink, 40 + Math.trunc((d - 14) * 60 / 72)) : cell.ink;
    output.px[i] = withAlpha(color, A(input.px[i]));
    lines[i] = line ? 1 : 0;
  }
  // 반쯤 투명한 테두리 칸에 걸린 외곽선은 흐리게 보여 선이 끊긴 것처럼 된다. 안쪽에 이미 또렷한 선이 받치고 있지 않으면 불투명하게 올린다.
  const alpha = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : A(input.px[y * w + x]));
  const solidLine = (x, y) => alpha(x, y) >= 200 && lines[y * w + x] === 1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, a = A(input.px[i]);
    if (a < 64) continue;
    const sides = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const backed = sides.some(([u, v]) => solidLine(x + u, y + v) && alpha(x - u, y - v) < 64);
    if (backed) continue;
    if (lines[i] === 1) { if (a < 200) output.px[i] = withAlpha(output.px[i], 255); continue; }
    // 선으로 뽑히지 않았어도, 맨 바깥 칸에 선이 조금이라도 걸려 있으면 선으로 이어 외곽선이 끊기지 않게 한다.
    if (cells[i].dark >= 8 && sides.some(([u, v]) => alpha(x + u, y + v) < 64)) output.px[i] = withAlpha(cells[i].ink, 255);
  }
  return output;
}

/** 가장자리 반투명 없애기: 절반 이상 덮인 칸은 불투명, 아니면 투명. */
export function hardEdge(input) {
  const output = input.clone();
  for (let i = 0; i < output.px.length; i++) output.px[i] = A(output.px[i]) >= 128 ? withAlpha(output.px[i], 255) : CLEAR;
  return output;
}

export function outlineStackLayers(percent) {
  return Number.isFinite(percent) ? Math.round(Math.max(0, Math.min(100, percent)) * 10) : 0;
}

/** 바깥 배경으로 이어진 반투명 검정 계열 픽셀의 알파만 겹쳐 올린다. */
export function stackDarkOutline(input, layers) {
  if (layers <= 1) return input;
  const { grid, px } = input;
  const exterior = new Uint8Array(grid.count), queue = [];
  const visit = i => {
    if (exterior[i] || A(px[i]) === 255) return;
    exterior[i] = 1;
    queue.push(i);
  };
  for (let i = 0; i < grid.count; i++) if (grid.edge(i)) visit(i);
  const alpha = Array.from({ length: 256 }, (_, a) => Math.round(255 * (1 - (1 - a / 255) ** layers)));
  const output = input.clone();
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head], p = px[i];
    grid.each4(i, visit);
    if (A(p) > 0 && light(p) <= 90 && chroma(p) <= 32) output.px[i] = withAlpha(p, alpha[A(p)]);
  }
  return output;
}

/**
 * 외톨이 점 정리: 둘레 어느 칸과도 색이 크게 다른 한 칸짜리 점을 둘레에서 가장 많은 색으로 바꾼다.
 * 선(어두운 칸)과, 어두운 칸에 둘러싸인 밝은 점(눈 하이라이트)은 건드리지 않는다.
 */
export function lonePixels(input) {
  const output = input.clone(), grid = input.grid, px = input.px;
  for (let i = 0; i < grid.count; i++) {
    const p = px[i];
    if (A(p) < 128 || light(p) < 110) continue;
    const around = [];
    grid.each8(i, j => { if (A(px[j]) >= 128) around.push(px[j]); });
    if (around.length < 6 || around.filter(q => light(q) < 110).length * 2 >= around.length) continue;
    if (around.some(q => distance(p, q) < 3600)) continue;
    const counts = new Map();
    for (const q of around) if (light(q) >= 110) counts.set(KEY(q), (counts.get(KEY(q)) ?? 0) + 1);
    let best = null, bestCount = 0;
    for (const q of around) { const n = counts.get(KEY(q)) ?? 0; if (n > bestCount) { best = q; bestCount = n; } }
    if (best !== null) output.px[i] = withAlpha(best, A(p));
  }
  return output;
}

/** 고정 팔레트. 여기에 줄을 더하면 '팔레트 고정' 목록에 나온다(이름, 16진수 색 목록). */
export const PALETTES = {
  pico8: { name: 'PICO-8 (16색)', colors: '000000 1D2B53 7E2553 008751 AB5236 5F574F C2C3C7 FFF1E8 FF004D FFA300 FFEC27 00E436 29ADFF 83769C FF77A8 FFCCAA' },
  sweetie16: { name: 'Sweetie 16 (16색)', colors: '1a1c2c 5d275d b13e53 ef7d57 ffcd75 a7f070 38b764 257179 29366f 3b5dc9 41a6f6 73eff7 f4f4f4 94b0c2 566c86 333c57' },
  gameboy: { name: '게임보이 (4색)', colors: '0f380f 306230 8bac0f 9bbc0f' },
};
/** '#ff0000, 00ff00 …'처럼 적은 16진수 색 목록을 읽는다(6자리만). */
export function parsePalette(text) {
  return (String(text).match(/[0-9a-fA-F]{6}/g) ?? []).map(hex => pack(parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)));
}
export function paletteColors(settings) {
  if (settings.palette === 'custom') return parsePalette(settings.paletteCustom);
  return PALETTES[settings.palette] ? parsePalette(PALETTES[settings.palette].colors) : [];
}
/** 팔레트 고정: 모든 칸을 팔레트에서 가장 가까운 색으로 바꾼다(투명도는 그대로). */
export function lockPalette(input, colors) {
  if (colors.length === 0) return input;
  const output = input.clone(), cache = new Map();
  for (let i = 0; i < output.px.length; i++) {
    const p = output.px[i];
    if (A(p) === 0) continue;
    let pick = cache.get(KEY(p));
    if (pick === undefined) {
      let closest = Infinity;
      for (const c of colors) { const d = distance(p, c); if (d < closest) { closest = d; pick = c; } }
      cache.set(KEY(p), pick);
    }
    output.px[i] = withAlpha(pick, A(p));
  }
  return output;
}

const linear = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
/** OKLab(밝기·색 차이를 사람 눈에 가깝게 재는 색 공간) */
function oklab(p) {
  const r = linear(R(p)), g = linear(G(p)), b = linear(B(p));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
}
const labDistance = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

/**
 * 색 수 줄이기: 그림에 쓰인 색을 count색으로 줄인다(투명도는 그대로).
 * 넓은 면이 색을 다 가져가 눈 같은 작은 색이 사라지지 않게, OKLab에서 이미 고른 색과 가장 먼 색을 먼저 고른다
 * (거리 × √쓰인 칸 수). 그 뒤 k-평균으로 다듬고, 묶음마다 실제로 쓰인 색 중 중심에 가장 가까운 색을 쓴다.
 */
export function reduceColors(input, count) {
  const bins = new Map();
  for (const p of input.px) {
    if (A(p) < 128) continue;
    const bin = bins.get(KEY(p));
    if (bin) bin.n++; else bins.set(KEY(p), { color: withAlpha(p, 255), lab: oklab(p), n: 1 });
  }
  const points = [...bins.values()];
  if (points.length <= count) return input;
  let centers = [points.reduce((a, b) => (b.n > a.n ? b : a)).lab];
  const gap = points.map(q => labDistance(q.lab, centers[0]));
  while (centers.length < count) {
    let pick = -1, best = 0;
    points.forEach((q, i) => { const score = gap[i] * Math.sqrt(q.n); if (score > best) { best = score; pick = i; } });
    if (pick < 0) break;
    centers.push(points[pick].lab);
    points.forEach((q, i) => { gap[i] = Math.min(gap[i], labDistance(q.lab, points[pick].lab)); });
  }
  const closest = (lab, list) => { let k = 0; for (let j = 1; j < list.length; j++) if (labDistance(lab, list[j]) < labDistance(lab, list[k])) k = j; return k; };
  let groups = [];
  for (let round = 0; round < 4; round++) {
    groups = points.map(q => closest(q.lab, centers));
    const sums = centers.map(() => [0, 0, 0, 0]);
    points.forEach((q, i) => { const sum = sums[groups[i]], weight = Math.sqrt(q.n); for (let c = 0; c < 3; c++) sum[c] += q.lab[c] * weight; sum[3] += weight; });
    centers = sums.map((sum, k) => (sum[3] ? [sum[0] / sum[3], sum[1] / sum[3], sum[2] / sum[3]] : centers[k]));
  }
  const chosen = centers.map((c, k) => points.filter((_, i) => groups[i] === k).reduce((a, q) => (!a || labDistance(q.lab, c) < labDistance(a.lab, c) ? q : a), null))
    .filter(Boolean);
  const chosenLab = chosen.map(q => q.lab), cache = new Map(), output = input.clone();
  for (let i = 0; i < output.px.length; i++) {
    const p = output.px[i];
    if (A(p) === 0) continue;
    let color = cache.get(KEY(p));
    if (color === undefined) cache.set(KEY(p), color = chosen[closest(oklab(p), chosenLab)].color);
    output.px[i] = withAlpha(color, A(p));
  }
  return output;
}

/**
 * 선 다듬기(pixel-perfect): 1픽셀 선이 꺾이는 곳의 ㄴ자 모서리 칸을 빼 계단을 매끄럽게 한다.
 * 선 칸(어두운 불투명 칸) 중 둘레 8칸의 선 칸이 가로 하나·세로 하나뿐인 칸만 뺀다(대각선으로 이어진다).
 * 뺀 칸은 둘레의 선이 아닌 칸에서 더 많은 쪽(투명 또는 가장 흔한 색)으로 채운다.
 */
export function pixelPerfect(input) {
  const output = input.clone(), { grid } = input, px = output.px, w = grid.w;
  const line = i => A(px[i]) >= 128 && light(px[i]) < 110;
  for (let i = 0; i < grid.count; i++) {
    if (!line(i)) continue;
    const x = i % w, y = (i - x) / w, around = [];
    grid.each8(i, j => { if (line(j)) around.push(j); });
    if (around.length !== 2) continue;
    const horizontal = around.find(j => Math.floor(j / w) === y), vertical = around.find(j => j % w === x);
    if (horizontal === undefined || vertical === undefined) continue;
    const counts = new Map();
    let clear = 0, solid = 0;
    grid.each8(i, j => {
      if (line(j)) return;
      if (A(px[j]) < 128) { clear++; return; }
      solid++;
      counts.set(px[j], (counts.get(px[j]) ?? 0) + 1);
    });
    if (clear >= solid) px[i] = CLEAR;
    else px[i] = [...counts].reduce((a, b) => (b[1] > a[1] ? b : a))[0];
  }
  return output;
}

/** 모든 방식 공통 마무리: 색 수·선·외톨이 점과 팔레트 정리 뒤에 가장자리 알파를 처리한다. */
function finishDot(result, settings) {
  let image = result.image;
  if (settings.autoColors > 0) image = reduceColors(image, settings.autoColors);
  if (settings.pixelPerfect) image = pixelPerfect(image);
  if (settings.lonePixels) image = lonePixels(image);
  if (settings.palette && settings.palette !== 'off') image = lockPalette(image, paletteColors(settings));
  if (settings.hardEdge) image = hardEdge(image);
  else image = stackDarkOutline(image, outlineStackLayers(settings.outlineStack));
  return image === result.image ? result : { ...result, image };
}
/** 원본 보존 그리기. 다른 축소 방식은 dot-resize.js가 그린 뒤 finishDot만 거친다. */
export function render(subject, reduced, settings) {
  return finishDot(renderFaithful(reduced, settings, subject), settings);
}
export function dotStatus(settings, dotted) {
  const layers = outlineStackLayers(settings.outlineStack);
  const done = [settings.gridPhase && settings.method === 'faithful' && '격자 위치 맞춤', settings.autoColors > 0 && `${settings.autoColors}색`,
    settings.pixelPerfect && '선 다듬기', settings.lonePixels && '외톨이 점 정리', settings.palette && settings.palette !== 'off' && paletteColors(settings).length > 0 && '팔레트 고정',
    settings.hardEdge && '가장자리 또렷', !settings.hardEdge && layers > 1 && `검정 테두리 ${layers}장 겹침`].filter(Boolean);
  return methodStatus(settings, dotted) + (done.length ? '  ·  ' + done.join(' · ') : '');
}
function methodStatus(settings, dotted) {
  if (settings.method === 'faithful') {
    const extras = [settings.sharpCells && '또렷하게', settings.snapColors && '원본 색 맞추기', settings.cleanBlends && '경계 섞인 색 정리', settings.preserveMouth && '작은 입선 보존', settings.crispOutline && '바깥 외곽선 원본 선 색'].filter(Boolean);
    return `원본 보존  ·  ${dotted.image.grid.w}×${dotted.image.grid.h} px  ·  투명 PNG${extras.length ? '  ·  ' + extras.join(' · ') : ''}`;
  }
  return `${dotMethodName(settings.method)}  ·  ${dotted.image.grid.w}×${dotted.image.grid.h} px  ·  투명 PNG`;
}

// ───────────────────────────── 원본 보존 (맥 시험판 DotMaker 100-100에서 옮김)
// 원본 픽셀이 최종 격자 한 칸에 걸치는 넓이만큼 그대로 평균 낸다(중간 축소 없음).

/**
 * 원본 칸이 목표 칸에 걸치는 길이. 단위는 목표 칸 하나 = source.
 * shift(0 ~ source-1)만큼 격자를 앞으로 당기면 끝에 칸이 하나 더 생긴다.
 */
function overlaps(source, target, shift = 0) {
  const total = source * target;
  return Array.from({ length: target + (shift > 0 ? 1 : 0) }, (_, cell) => {
    const start = Math.max(0, cell * source - shift), end = Math.min(total, (cell + 1) * source - shift), list = [];
    for (let pixel = Math.floor(start / target); pixel <= Math.floor((end - 1) / target); pixel++) {
      list.push([pixel, Math.min(end, (pixel + 1) * target) - Math.max(start, pixel * target)]);
    }
    return list;
  });
}

export function reduceDirect(subject, w, h, phase = [0, 0]) {
  if (!(w >= 16 && w <= 250 && h >= 16 && h <= 250)) fail('dimensions');
  const scale = Math.min((w - 4) / subject.grid.w, (h - 4) / subject.grid.h);
  const columns = overlaps(subject.grid.w, Math.max(1, Math.round(subject.grid.w * scale)), Math.round(phase[0] * subject.grid.w));
  const rows = overlaps(subject.grid.h, Math.max(1, Math.round(subject.grid.h * scale)), Math.round(phase[1] * subject.grid.h));
  const sw = columns.length, sh = rows.length;
  const x = Math.trunc((w - sw) / 2), y = Math.trunc((h - sh) / 2);
  const area = subject.grid.w * subject.grid.h, sp = subject.px, sW = subject.grid.w;
  const output = new Raster(w, h);
  const cells = Array.from({ length: w * h }, () => ({ fill: CLEAR, ink: BLACK, cover: 0, dark: 0, accent: 0, accentColor: CLEAR }));
  for (let v = 0; v < sh; v++) {
    for (let u = 0; u < sw; u++) {
      const average = new Acc(), fill = new Acc(), ink = new Acc(), accent = new Acc();
      for (const [row, rowLength] of rows[v]) {
        for (const [column, columnLength] of columns[u]) {
          const p = sp[row * sW + column];
          if (A(p) === 0) continue;
          const weight = rowLength * columnLength;
          average.add(p, weight);
          if (light(p) < 110) ink.add(p, weight); else fill.add(p, weight);
          if (chroma(p) >= 28 && light(p) >= 100) accent.add(p, weight);
        }
      }
      const cover = Math.floor(average.weight / area);
      if (!(cover > 0)) continue;
      const dark = Math.floor(ink.weight * 100 / average.weight);
      const accentShare = Math.floor(accent.weight * 100 / average.weight);
      const mean = average.color, fillColor = fill.weight === 0 ? mean : fill.color;
      const i = (v + y) * w + u + x;
      cells[i] = { fill: fillColor, ink: ink.color, cover, dark, accent: accentShare, accentColor: accent.color };
      // 여러 원본 픽셀이 받치는 선은 대비를 되살린다.
      const p = dark >= 25 && dark < 75 && cover >= 150 ? mixed(mean, ink.color, Math.trunc((dark - 20) / 2)) : mean;
      output.px[i] = withAlpha(p, cover);
    }
  }
  return { image: output, cells, contentRect: { x, y, w: sw, h: sh } };
}

/**
 * 격자 위치 맞추기: 칸 시작 위치를 가로·세로 0·1/3·2/3칸씩 옮겨 9가지로 읽고,
 * 선이 칸에 반쯤 걸쳐 흐려진 정도(어두운 비율이 50%에 가까운 칸)와 반쯤 덮인 가장자리 칸이 가장 적은 것을 고른다.
 */
export function reduceAligned(subject, w, h) {
  let best = null, bestBlur = Infinity;
  for (const py of [0, 1 / 3, 2 / 3]) {
    for (const px of [0, 1 / 3, 2 / 3]) {
      const reduced = reduceDirect(subject, w, h, [px, py]);
      let blur = 0;
      for (const c of reduced.cells) if (c.cover > 0) blur += Math.min(c.dark, 100 - c.dark) * c.cover / 255 + Math.min(c.cover, 255 - c.cover) / 2.55;
      if (blur < bestBlur) { best = reduced; bestBlur = blur; }
    }
  }
  return best;
}

/**
 * 축소 평균 때문에 경계에 생긴 탁한 중간색(빨강+검정 → 자주) 칸마다, 사이에 낀 두 이웃 색 중
 * 가까운 쪽(near)과 진한 쪽(dark)을 돌려준다. 색 차이가 작은 이웃(부드러운 명암)은 건드리지 않는다.
 */
export function blendCandidates(input) {
  const minGap = 120, maxOff = 28, minAway = 30;
  const grid = input.grid, px = input.px, picks = new Map();
  const vec = p => [R(p), G(p), B(p)];
  const len = v => Math.hypot(v[0], v[1], v[2]);
  for (let i = 0; i < grid.count; i++) {
    if (A(px[i]) < 128) continue;
    const c = vec(px[i]), around = [];
    grid.each8(i, j => { if (A(px[j]) >= 128) around.push(px[j]); });
    let best = null;
    for (let m = 0; m < around.length; m++) {
      for (let n = m + 1; n < around.length; n++) {
        const a = vec(around[m]), b = vec(around[n]), ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const gap = len(ab);
        if (gap < minGap) continue;
        const ca = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        if (len(ca) < minAway || len([c[0] - b[0], c[1] - b[1], c[2] - b[2]]) < minAway) continue;
        const t = (ca[0] * ab[0] + ca[1] * ab[1] + ca[2] * ab[2]) / (gap * gap);
        if (t < 0.15 || t > 0.85) continue;
        const off = len([ca[0] - ab[0] * t, ca[1] - ab[1] * t, ca[2] - ab[2] * t]);
        // 회색처럼 세 색이 거의 일직선이면 동점이 많아, 아주 작은 계산 오차로 순서가 바뀌지 않게 여유를 둔다.
        if (off <= maxOff && off < (best?.off ?? Infinity) - 1e-6) {
          const dark = light(around[m]) <= light(around[n]) ? around[m] : around[n];
          best = { off, near: t < 0.5 ? around[m] : around[n], dark };
        }
      }
    }
    if (best) picks.set(i, { near: withAlpha(best.near, A(px[i])), dark: withAlpha(best.dark, A(px[i])) });
  }
  return picks;
}

export function cleanBlends(input) {
  const output = input.clone();
  for (const [i, pick] of blendCandidates(input)) output.px[i] = pick.near;
  return output;
}

/**
 * 가장 바깥 외곽선을 검은 1픽셀로 다시 긋고 그 바깥의 흐린 칸을 지운다.
 * 테두리가 대부분 밝은 조각(흰 외곽선)과 조각 맨 아래의 회색(바닥 그림자)은 검정으로 덮지 않는다.
 */
/** 원본 색 맞추기: 축소 평균으로 생긴 중간색 대신, 그 칸(둘레 반 칸 포함) 원본에 실제로 있는 가장 가까운 색을 넣는다. */
export function snapColors(input, reduced, subject) {
  const output = input.clone(), w = input.grid.w;
  const { x: ox, y: oy, w: sw, h: sh } = reduced.contentRect;
  const W = subject.grid.w, H = subject.grid.h, sp = subject.px;
  const cw = W / sw, ch = H / sh, mx = Math.max(1, Math.trunc(cw / 2)), my = Math.max(1, Math.trunc(ch / 2));
  for (let v = 0; v < sh; v++) {
    const y0 = Math.max(0, Math.trunc(v * ch) - my), y1 = Math.min(H, Math.trunc((v + 1) * ch) + my);
    for (let u = 0; u < sw; u++) {
      const i = (v + oy) * w + u + ox, p = input.px[i];
      if (A(p) < 128) continue;
      const x0 = Math.max(0, Math.trunc(u * cw) - mx), x1 = Math.min(W, Math.trunc((u + 1) * cw) + mx);
      let best = null, bestDistance = Infinity;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const q = sp[y * W + x];
        if (A(q) < 128) continue;
        const d = distance(p, q);
        if (d < bestDistance) { bestDistance = d; best = q; }
      }
      if (best !== null) output.px[i] = withAlpha(best, A(p));
    }
  }
  return output;
}

/**
 * 가장 바깥 실루엣을 1픽셀 선으로 또렷하게 긋고 원본 알파는 유지한다.
 * cells가 있으면 원본 그 자리에 선이 있는 칸만 원본 선 색으로(없는 칸은 제 색 그대로), 없으면 전부 검정.
 * 바깥 테두리가 대부분 밝은 조각(일부러 그린 흰 외곽선)은 제 색을 둔다.
 */
export function crispOutline(input, cells = null) {
  const grid = input.grid, px = input.px, output = input.clone();
  const solid = Array.from(px, p => A(p) >= 128);
  for (const piece of grid.components(solid)) {
    const rim = piece.filter(i => { let edge = false; grid.each4(i, j => { if (!solid[j]) edge = true; }); return edge; });
    const lightRim = rim.filter(i => light(px[i]) >= 170).length * 2 > rim.length;
    let top = Infinity, bottom = -1;
    for (const i of piece) { const y = (i / grid.w) | 0; top = Math.min(top, y); bottom = Math.max(bottom, y); }
    const floor = bottom - Math.max(3, Math.trunc((bottom - top) * 8 / 100));
    const shadow = i => ((i / grid.w) | 0) >= floor && chroma(px[i]) <= 24 && light(px[i]) >= 45 && light(px[i]) <= 180;
    const outline = new Set(lightRim ? [] : rim.filter(i => !shadow(i)));
    for (const i of piece) {
      const line = !outline.has(i) ? null : !cells ? BLACK : cells[i].dark >= 5 ? cells[i].ink : null;
      if (line !== null) output.px[i] = withAlpha(line, A(px[i]));
    }
  }
  return output;
}

export function renderFaithful(reduced, settings, subject) {
  let image = settings.sharpCells ? sharpCells(reduced) : reduced.image;
  if (settings.snapColors) image = snapColors(image, reduced, subject);
  if (settings.cleanBlends) image = cleanBlends(image);
  if (settings.preserveMouth) { image = image.clone(); FaceDetail.preserveMouth(image, reduced); }
  if (settings.crispOutline) image = crispOutline(image, reduced.cells);
  return { image };
}
