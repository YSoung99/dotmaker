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
  dimensions: '가로와 세로를 각각 16~512px로 입력해 주세요.',
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
/** PixelConverter.rasterize */
const rasterize = (image, width, height, rect) => draw(image, width, height, rect, true);

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

// ───────────────────────────── 2.0 방식: 축소(Reduced)
class Acc {
  constructor() { this.r = 0; this.g = 0; this.b = 0; this.weight = 0; }
  add(p, area = 1) { const a = A(p) * area; this.r += R(p) * a; this.g += G(p) * a; this.b += B(p) * a; this.weight += a; }
  get color() {
    if (this.weight <= 0) return BLACK;
    return pack(Math.floor(this.r / this.weight), Math.floor(this.g / this.weight), Math.floor(this.b / this.weight));
  }
}

export function reduce(subject, w, h) {
  if (!(w >= 16 && w <= 512 && h >= 16 && h <= 512)) fail('dimensions');
  const source = subject.image();
  const scale = Math.min((w - 4) / subject.grid.w, (h - 4) / subject.grid.h);
  const sw = Math.max(1, Math.round(subject.grid.w * scale));
  const sh = Math.max(1, Math.round(subject.grid.h * scale));
  const x = Math.trunc((w - sw) / 2), y = Math.trunc((h - sh) / 2);
  const factor = 6, samples = factor * factor;
  const sampled = Raster.from(source, sw * factor, sh * factor);
  const output = new Raster(w, h);
  const cells = Array.from({ length: w * h }, () => ({ fill: CLEAR, ink: BLACK, cover: 0, dark: 0, accent: 0, accentColor: CLEAR }));
  const sp = sampled.px, sW = sampled.grid.w;
  for (let v = 0; v < sh; v++) {
    for (let u = 0; u < sw; u++) {
      const average = new Acc(), fill = new Acc(), ink = new Acc(), accent = new Acc();
      for (let sy = 0; sy < factor; sy++) {
        for (let sx = 0; sx < factor; sx++) {
          const p = sp[(v * factor + sy) * sW + u * factor + sx];
          if (A(p) === 0) continue;
          average.add(p);
          if (light(p) < 110) ink.add(p); else fill.add(p);
          if (chroma(p) >= 28 && light(p) >= 100) accent.add(p);
        }
      }
      const cover = Math.floor(average.weight / samples);
      if (!(cover > 0)) continue;
      const dark = Math.floor(ink.weight * 100 / average.weight);
      const accentShare = Math.floor(accent.weight * 100 / average.weight);
      const mean = average.color, fillColor = fill.weight === 0 ? mean : fill.color;
      const i = (v + y) * w + u + x;
      cells[i] = { fill: fillColor, ink: ink.color, cover, dark, accent: accentShare, accentColor: accent.color };
      const p = dark >= 25 && dark < 75 && cover >= 150 ? mixed(mean, ink.color, Math.trunc((dark - 20) / 2)) : mean;
      output.px[i] = withAlpha(p, cover);
    }
  }
  return { image: output, cells };
}

// ───────────────────────────── 2.0 방식: 도트화
// method: 'berry' 베리 잉크 · 'basic' 2.0 방식 · 'soft' 원본 색 살림(개선판 '약하게', 색 수는 softColors)
// softLines: 원본 색 살림에서 선을 1픽셀로 정리(원본에서 선 줄기 찾기) · softVivid: 원본 색 살림에서 채도 25% 올리기
// softClean: 원본 색 살림에서 바깥 테두리를 순검정 1px로 잇고 색 면 정리(비슷한 색 합치기·혼자 떨어진 점 지우기)
export const defaultSettings = () => ({ width: 1, boundary: true, transparency: 80, colors: 12, cleanup: 1, method: 'faithful', aiLines: false, softColors: 24, softLines: true, softVivid: true, softClean: true, crispOutline: false, cleanBlends: false, snapColors: false, preserveMouth: false, upscale: 'auto' });

class Palette {
  constructor(pixels) {
    const counts = [new Map(), new Map(), new Map(), new Map()];
    for (const p of pixels) {
      const key = Math.floor(R(p) / 22) * 144 + Math.floor(G(p) / 22) * 12 + Math.floor(B(p) / 22);
      const bins = counts[Palette.family(p)];
      if (!bins.has(key)) bins.set(key, new Acc());
      bins.get(key).add(p);
    }
    const limits = [4, 6, 5, 6];
    this.colors = counts.map((bins, family) => {
      const chosen = [];
      const ranked = [...bins].sort((a, b) => (a[1].weight === b[1].weight ? a[0] - b[0] : b[1].weight - a[1].weight));
      for (const [, bin] of ranked) {
        if (chosen.length >= limits[family]) continue;
        const color = bin.color;
        if (!chosen.some(c => distance(c, color) < 380)) chosen.push(color);
      }
      return chosen;
    });
  }
  nearest(p, preservingSmallColor = false) {
    const choices = this.colors[Palette.family(p)];
    const closest = firstMin(choices, (a, b) => distance(a, p) < distance(b, p));
    if (closest === undefined) return p;
    if (preservingSmallColor && distance(closest, p) > 2700) return p;
    return closest;
  }
  static family(p) {
    if (chroma(p) <= 24) return 0;
    if (pink(p)) return 1;
    if (B(p) > G(p) && B(p) >= R(p) - 12) return 2;
    return 3;
  }
}

export function renderBasic(input, settings, lines = null) {
  const grid = input.image.grid, cells = input.cells;
  const mask = cells.map(c => c.cover >= 116);
  if (!mask.includes(true)) fail('subject');
  const W = settings.width;
  const depth = grid.depths(mask);
  const outline = Array.from(depth, d => d >= 1 && d <= W);
  const head = largest(grid.components(mask.map((m, i) => m && pink(cells[i].fill))));
  const headY = head.length === 0 ? 0 : Math.floor(head.reduce((s, i) => s + Math.floor(i / grid.w), 0) / head.length);
  const body = largest(grid.components(mask.map((m, i) => depth[i] > W && Math.floor(i / grid.w) > headY && paper(cells[i].fill)), false));
  const isBody = new Set(body);
  const boundary = new Array(grid.count).fill(false);
  const palettePixels = [];
  for (let i = 0; i < grid.count; i++) if (mask[i] && !outline[i] && cells[i].dark < 57) palettePixels.push(cells[i].fill);
  const palette = new Palette(palettePixels);

  const rim = outline.slice();
  for (let layer = W + 1; layer <= W + 2; layer++) {
    for (let i = 0; i < grid.count; i++) {
      if (!(depth[i] === layer && cells[i].dark >= 18)) continue;
      let attached = false;
      grid.each4(i, j => { if (depth[j] === layer - 1 && rim[j]) attached = true; });
      if (attached) rim[i] = true;
    }
  }

  let output = new Raster(grid.w, grid.h);
  for (let i = 0; i < grid.count; i++) {
    if (!mask[i]) continue;
    if (outline[i]) { output.px[i] = BLACK; continue; }
    const cell = cells[i];
    let color;
    let bodyEdge = isBody.has(i);
    if (cell.dark >= 48 && !rim[i]) {
      color = pack(Math.max(13, R(cell.ink)), Math.max(10, G(cell.ink)), Math.max(13, B(cell.ink)));
    } else {
      let fill = cell.fill;
      if (depth[i] <= W + 2) {
        const anchors = [];
        grid.each8(i, j => { if (depth[j] > depth[i] && cells[j].dark < 30) anchors.push(j); });
        const hairAnchors = anchors.filter(j => pink(cells[j].fill));
        const bodyAnchors = anchors.filter(j => isBody.has(j));
        let nearest;
        if (!pink(fill) && bodyAnchors.length > 0 && bodyAnchors.length > hairAnchors.length &&
            (paper(fill) || (rim[i] && chroma(fill) < 38))) {
          bodyEdge = true;
          fill = cells[bodyAnchors[0]].fill;
        } else if (rim[i] && !pink(fill) && hairAnchors.length * 2 > anchors.length &&
                   (chroma(fill) < 36 || light(fill) < 158)) {
          fill = cells[hairAnchors[0]].fill;
        } else if (rim[i] && (cell.dark > 45 || light(fill) < 158) &&
                   (nearest = firstMin(anchors, (a, b) => distance(cells[a].fill, fill) < distance(cells[b].fill, fill))) !== undefined) {
          fill = cells[nearest].fill;
        }
      }
      color = palette.nearest(fill);
    }
    boundary[i] = depth[i] === W + 1 && bodyEdge && paper(color);
    if (settings.boundary && boundary[i]) {
      const intermediate = mixed(color, BLACK, 50);
      output.px[i] = mixed(color, intermediate, 100 - settings.transparency);
    } else {
      output.px[i] = color;
    }
  }
  LineCleanup.apply(output, mask, outline, W);
  if (lines) LineGuide.apply(output, mask, outline, W, lines);
  FaceDetail.apply(output, mask);
  output = ColorReducer.apply(output, outline, boundary, settings);
  return { image: output, mask, outline, boundary, bodyCount: body.length, headCount: head.length };
}

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

// ───────────────────────────── 선 추출 AI 선 지도 반영
export const LineGuide = {
  /** lines: 캐릭터(subject)와 같은 크기의 선 지도(Raster). 어두울수록 선. */
  apply(raster, mask, outline, width, lines) {
    const grid = raster.grid, isInk = LineCleanup.isInk;
    const coverage = sampleLines(lines, mask, grid);
    if (!coverage) return 0;
    const depth = grid.depths(mask);
    const ink = new Map();
    for (let i = 0; i < grid.count; i++) if (mask[i] && !outline[i] && isInk(raster.px[i])) countVotes(ink, KEY(raster.px[i]), raster.px[i]);
    const lineColor = firstMax(ink.values(), (a, b) => a[0] < b[0])?.[1] ?? BLACK;
    const inner = mask.map((m, i) => m && !outline[i] && depth[i] > width + 2);
    const near = (i, test) => { let hit = test(i); grid.each8(i, j => { if (test(j)) hit = true; }); return hit; };
    const before = raster.px.slice();
    const skeleton = mask.map((_, i) => inner[i] && coverage[i] >= 0.35);
    LineCleanup.skeletonize(skeleton, grid);
    const hadInk = mask.map((m, i) => m && (outline[i] || isInk(raster.px[i])));
    const added = new Array(grid.count).fill(false);
    for (let i = 0; i < grid.count; i++) {
      if (skeleton[i] && !hadInk[i] && !near(i, j => hadInk[j] && j !== i)) { raster.px[i] = lineColor; added[i] = true; }
    }
    const seen = new Array(grid.count).fill(false);
    let total = 0;
    for (let start = 0; start < grid.count; start++) {
      if (!added[start] || seen[start]) continue;
      const piece = [start];
      let touches = false;
      seen[start] = true;
      for (let next = 0; next < piece.length; next++) {
        grid.each8(piece[next], j => { if (added[j] && !seen[j]) { seen[j] = true; piece.push(j); } else if (hadInk[j]) touches = true; });
      }
      if (!touches && piece.length < 3) for (const i of piece) { raster.px[i] = before[i]; added[i] = false; }
      else total += piece.length;
    }
    return total;
  },
};

function sampleLines(lines, mask, grid) {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let i = 0; i < grid.count; i++) {
    if (!mask[i]) continue;
    const x = i % grid.w, y = (i / grid.w) | 0;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  if (x1 < 0) return null;
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1, factor = 4;
  const scaled = Raster.from(lines.image(), bw * factor, bh * factor);
  const coverage = new Float64Array(grid.count);
  for (let v = 0; v < bh; v++) for (let u = 0; u < bw; u++) {
    let dark = 0;
    for (let sy = 0; sy < factor; sy++) for (let sx = 0; sx < factor; sx++) if (light(scaled.px[(v * factor + sy) * scaled.grid.w + u * factor + sx]) < 128) dark++;
    coverage[(v + y0) * grid.w + u + x0] = dark / (factor * factor);
  }
  return coverage;
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

// ───────────────────────────── OKLab (Float32)
// 맥에서 powf로 만든 표를 비트 그대로 옮겼다(JS로 다시 계산하면 2칸이 1ulp 다르다).
// prettier-ignore
const LINEAR_BITS = [0,966730420,975119028,980333582,983507636,986114913,988722190,990592605,991896244,993199883,994503521,995840397,997257613,998498758,999286294,1000114173,1000982967,1001893231,1002845513,1003840353,1004878273,1005959792,1006859189,1007444306,1008051971,1008682430,1009335915,1010012663,1010712905,1011436867,1012184775,1012956849,1013753311,1014574370,1015220904,1015656351,1016104411,1016565189,1017038786,1017525299,1018024829,1018537473,1019063328,1019602489,1020155051,1020721109,1021300752,1021894073,1022501164,1023122113,1023583593,1023908060,1024239590,1024578223,1024924003,1025276974,1025637180,1026004658,1026379451,1026761600,1027151147,1027548131,1027952593,1028364572,1028784111,1029211242,1029646007,1030088446,1030538596,1030996495,1031462185,1031867240,1032107925,1032352560,1032601162,1032853750,1033110341,1033370954,1033635606,1033904315,1034177099,1034453975,1034734960,1035020072,1035309330,1035602747,1035900341,1036202130,1036508130,1036818358,1037132831,1037451564,1037774575,1038101879,1038433493,1038769433,1039109714,1039454353,1039803368,1040156769,1040350983,1040532096,1040715427,1040900984,1041088773,1041278804,1041471083,1041665618,1041862416,1042061485,1042262832,1042466467,1042672393,1042880620,1043091152,1043304001,1043519172,1043736673,1043956510,1044178691,1044403222,1044630111,1044859364,1045090990,1045324994,1045561383,1045800166,1046041347,1046284939,1046530940,1046779360,1047030207,1047283488,1047539212,1047797380,1048058000,1048321080,1048581314,1048715324,1048850573,1048987066,1049124805,1049263794,1049404035,1049545533,1049688289,1049832308,1049977592,1050124145,1050271970,1050421070,1050571447,1050723106,1050876050,1051030280,1051185801,1051342616,1051500727,1051660137,1051820851,1051982872,1052146200,1052310839,1052476793,1052644065,1052812657,1052982573,1053153815,1053326387,1053500291,1053675531,1053852109,1054030028,1054209291,1054389901,1054571860,1054755173,1054939841,1055125867,1055313255,1055502007,1055692125,1055883613,1056076474,1056270710,1056466324,1056663319,1056861698,1057013037,1057113614,1057214887,1057316857,1057419526,1057522895,1057626966,1057731739,1057837216,1057943399,1058050289,1058157886,1058266193,1058375211,1058484941,1058595385,1058706543,1058818417,1058931009,1059044319,1059158350,1059273102,1059388576,1059504774,1059621697,1059739347,1059857725,1059976832,1060096670,1060217239,1060338540,1060460576,1060583347,1060706854,1060831100,1060956085,1061081810,1061208276,1061335486,1061463440,1061592139,1061721585,1061851778,1061982721,1062114414,1062246859,1062380056,1062514007,1062648714,1062784176,1062920397,1063057376,1063195116,1063333614,1063472879,1063612905,1063753699,1063895254,1064037581,1064180671,1064324536,1064469167,1064614574,1064760750,1064907705,1065055430,1065203936,1065353216];
const LINEAR = new Float32Array(Uint32Array.from(LINEAR_BITS).buffer);
const L1 = F(0.41222147), L2 = F(0.53633255), L3 = F(0.05144599);
const M1 = F(0.21190350), M2 = F(0.68069955), M3 = F(0.10739696);
const S1 = F(0.08830246), S2 = F(0.28171884), S3 = F(0.62997870);
const X1 = F(0.21045426), X2 = F(0.79361779), X3 = F(0.00407205);
const Y1 = F(1.97799850), Y2 = F(2.42859221), Y3 = F(0.45059371);
const Z1 = F(0.02590404), Z2 = F(0.78277177), Z3 = F(0.80867577);

/** decodeLab(바이트 rgba, alpha) — 프리멀티플라이 값과 알파로 */
// 같은 색은 계속 나오므로 곧은 RGB(24비트)별로 한 번만 계산한다. 돌려준 배열은 고치지 않는다(여럿이 함께 씀).
const labCache = new Map();
export function decodeLab(r8, g8, b8, alpha) {
  const half = alpha >> 1;
  const ri = Math.min(255, ((r8 * 255 + half) / alpha) | 0);
  const gi = Math.min(255, ((g8 * 255 + half) / alpha) | 0);
  const bi = Math.min(255, ((b8 * 255 + half) / alpha) | 0);
  const key = (ri << 16) | (gi << 8) | bi;
  let lab = labCache.get(key);
  if (lab) return lab;
  const r = LINEAR[ri], g = LINEAR[gi], b = LINEAR[bi];
  const l = F(Math.cbrt(F(F(F(L1 * r) + F(L2 * g)) + F(L3 * b))));
  const m = F(Math.cbrt(F(F(F(M1 * r) + F(M2 * g)) + F(M3 * b))));
  const s = F(Math.cbrt(F(F(F(S1 * r) + F(S2 * g)) + F(S3 * b))));
  lab = [F(F(F(X1 * l) + F(X2 * m)) - F(X3 * s)), F(F(F(Y1 * l) - F(Y2 * m)) + F(Y3 * s)), F(F(F(Z1 * l) + F(Z2 * m)) - F(Z3 * s))];
  if (labCache.size > 1 << 20) labCache.clear();
  labCache.set(key, lab);
  return lab;
}
const labAt = (bytes, i, alpha) => decodeLab(bytes[i * 4], bytes[i * 4 + 1], bytes[i * 4 + 2], alpha);

const E1 = F(0.39633778), E2 = F(0.21580376), E3 = F(0.10556135), E4 = F(0.06385417), E5 = F(0.08948418), E6 = F(1.29148555);
const C1 = F(4.07674166), C2 = F(3.30771159), C3 = F(0.23096993);
const C4 = F(-1.26843800), C5 = F(2.60975740), C6 = F(0.34131940);
const C7 = F(-0.00419609), C8 = F(0.70341861), C9 = F(1.70761470);
const INV24 = F(1 / F(2.4)), K12 = F(12.92), K1055 = F(1.055), K055 = F(0.055), KLIN = F(0.0031308);
function encodeSRGB(c) {
  const l = F(F(c[0] + F(E1 * c[1])) + F(E2 * c[2]));
  const m = F(F(c[0] - F(E3 * c[1])) - F(E4 * c[2]));
  const s = F(F(c[0] - F(E5 * c[1])) - F(E6 * c[2]));
  const ll = F(F(l * l) * l), mm = F(F(m * m) * m), ss = F(F(s * s) * s);
  return [encodeChannel(F(F(F(C1 * ll) - F(C2 * mm)) + F(C3 * ss))),
    encodeChannel(F(F(F(C4 * ll) + F(C5 * mm)) - F(C6 * ss))),
    encodeChannel(F(F(F(C7 * ll) - F(C8 * mm)) + F(C9 * ss)))];
}
function encodeChannel(linear) {
  const clamped = Math.min(1, Math.max(0, linear));
  const encoded = clamped <= KLIN ? F(clamped * K12) : F(F(K1055 * F(Math.pow(clamped, INV24))) - K055);
  return roundAway(F(encoded * 255));
}

// 벡터 도우미 (Float32)
const vadd = (a, b) => [F(a[0] + b[0]), F(a[1] + b[1]), F(a[2] + b[2])];
const vsub = (a, b) => [F(a[0] - b[0]), F(a[1] - b[1]), F(a[2] - b[2])];
const vmul = (a, s) => [F(a[0] * s), F(a[1] * s), F(a[2] * s)];
const vdiv = (a, s) => [F(a[0] / s), F(a[1] / s), F(a[2] / s)];
function dist2(a, b) {
  const x = F(a[0] - b[0]), y = F(a[1] - b[1]), z = F(a[2] - b[2]);
  return F(F(F(x * x) + F(y * y)) + F(z * z));
}
const len2 = (y, z) => F(Math.sqrt(F(F(y * y) + F(z * z))));
const vdist = (a, b) => F(Math.sqrt(dist2(a, b)));
const ZERO = () => [0, 0, 0];

// ───────────────────────────── 베리 잉크 (예전 변환기)
function fit(sw, sh, cw, ch) {
  const scale = Math.min(cw / sw, ch / sh);
  const width = Math.max(1, Math.min(cw, Math.round(sw * scale)));
  const height = Math.max(1, Math.min(ch, Math.round(sh * scale)));
  const x = Math.trunc((cw - width) / 2), top = Math.trunc((ch - height) / 2);
  return { x, y: ch - height - top, w: width, h: height, top };
}

/** 테두리에 닿은 밝고 무채색인 영역만 지운다. 투명 원본은 그대로. */
export function withoutLightBackground(source) {
  const image = source;
  const scale = Math.min(1, 1024 / Math.max(image.w, image.h));
  const w = Math.max(1, Math.round(image.w * scale)), h = Math.max(1, Math.round(image.h * scale));
  const bytes = rasterize(image, w, h, { x: 0, y: 0, w, h });
  if (!(w > 2 && h > 2)) return source;
  const count = w * h, state = new Uint8Array(count);
  let hasAlpha = false, lightBorder = 0;
  const borderCount = 2 * w + 2 * h - 4;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, o = i * 4;
    if (bytes[o + 3] < 250) hasAlpha = true;
    const low = Math.min(bytes[o], bytes[o + 1], bytes[o + 2]), high = Math.max(bytes[o], bytes[o + 1], bytes[o + 2]);
    if (low >= 207 && high - low <= 30) {
      state[i] = 1;
      if (x === 0 || x === w - 1 || y === 0 || y === h - 1) lightBorder++;
    }
  }
  if (hasAlpha || !(lightBorder * 4 >= borderCount * 3)) return source;
  let queue = [];
  const addBackground = i => { if (state[i] === 1) { state[i] = 2; queue.push(i); } };
  for (let x = 0; x < w; x++) { addBackground(x); addBackground((h - 1) * w + x); }
  for (let y = 1; y < h - 1; y++) { addBackground(y * w); addBackground(y * w + w - 1); }
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head], x = i % w;
    if (x > 0) addBackground(i - 1);
    if (x + 1 < w) addBackground(i + 1);
    if (i >= w) addBackground(i - w);
    if (i + w < count) addBackground(i + w);
  }
  if (!(queue.length > Math.floor(count / 12))) return source;
  const components = [];
  for (let i = 0; i < count; i++) {
    if (!(state[i] < 2)) continue;
    state[i] = 3;
    queue = [i];
    for (let head = 0; head < queue.length; head++) {
      const p = queue[head], x = p % w, y = (p / w) | 0;
      for (let v = Math.max(0, y - 1); v <= Math.min(h - 1, y + 1); v++) for (let u = Math.max(0, x - 1); u <= Math.min(w - 1, x + 1); u++) {
        const n = v * w + u;
        if (state[n] < 2) { state[n] = 3; queue.push(n); }
      }
    }
    if (queue.length >= 4) components.push(queue);
  }
  const big = components.reduce((m, c) => Math.max(m, c.length), 0);
  if (!(big >= Math.max(4, Math.floor(count / 100)))) return source;
  let minX = w, minY = h, maxX = 0, maxY = 0;
  for (const component of components) {
    if (component.length < Math.max(4, Math.floor(big / 28))) continue;
    for (const i of component) {
      state[i] = 4;
      minX = Math.min(minX, i % w); maxX = Math.max(maxX, i % w);
      minY = Math.min(minY, (i / w) | 0); maxY = Math.max(maxY, (i / w) | 0);
    }
  }
  const pad = Math.max(1, Math.round(0.04 * Math.max(maxX - minX + 1, maxY - minY + 1)));
  minX = Math.max(0, minX - pad); maxX = Math.min(w - 1, maxX + pad);
  minY = Math.max(0, minY - pad); maxY = Math.min(h - 1, maxY + pad);
  for (let i = 0; i < count; i++) if (state[i] !== 4) bytes.fill(0, i * 4, i * 4 + 4);
  const cw = maxX - minX + 1, ch = maxY - minY + 1, data = new Uint8Array(cw * ch * 4);
  for (let y = 0; y < ch; y++) data.set(bytes.subarray(((y + minY) * w + minX) * 4, ((y + minY) * w + minX + cw) * 4), y * cw * 4);
  return { w: cw, h: ch, data };
}

/** 출력 격자 위치(¼칸 단위, -2…2) 고르기 */
export function bestGrid(prepared, size) {
  const scale = Math.min(size.w / prepared.w, size.h / prepared.h);
  const width = Math.max(1, Math.min(size.w, Math.round(prepared.w * scale)));
  const height = Math.max(1, Math.min(size.h, Math.round(prepared.h * scale)));
  const def = [-1, -1];
  if (width < 4 || height < 4) return def;
  const side = 4, margin = 4;
  const sw = width * side, sh = height * side, tw = sw + margin * 2, th = sh + margin * 2;
  const bytes = rasterize(prepared, tw, th, { x: margin, y: margin, w: sw, h: sh });
  const s = new Float32Array(bytes.length);
  for (let k = 0; k < bytes.length; k++) s[k] = F(bytes[k] / 255);
  // 표본마다 제곱합은 위치 후보 25개가 모두 같은 값을 쓰므로 한 번만 계산한다.
  const q = new Float32Array(tw * th);
  for (let k = 0; k < q.length; k++) {
    const o = k * 4, a = s[o], b = s[o + 1], c = s[o + 2], d = s[o + 3];
    q[k] = F(F(F(a * a) + F(b * b)) + F(F(c * c) + F(d * d)));
  }
  const cellCount = F(side * side);
  let fallback, best = null;
  for (let gy = -2; gy <= 2; gy++) for (let gx = -2; gx <= 2; gx++) {
    const ox = margin - gx, oy = margin - gy;
    let total = 0;
    for (let cy = 1; cy < height - 1; cy++) for (let cx = 1; cx < width - 1; cx++) {
      let s0 = 0, s1 = 0, s2 = 0, s3 = 0, squares = 0;
      for (let sy = 0; sy < side; sy++) {
        const base = (oy + cy * side + sy) * tw + ox + cx * side;
        for (let sx = 0; sx < side; sx++) {
          const o = (base + sx) * 4;
          s0 = F(s0 + s[o]); s1 = F(s1 + s[o + 1]); s2 = F(s2 + s[o + 2]); s3 = F(s3 + s[o + 3]);
          squares = F(squares + q[base + sx]);
        }
      }
      const dot = F(F(F(s0 * s0) + F(s1 * s1)) + F(F(s2 * s2) + F(s3 * s3)));
      total = F(total + F(squares - F(dot / cellCount)));
    }
    const key = [gx, gy];
    if (gx === -1 && gy === -1) fallback = total;
    if (!best || total < best.value || (total === best.value && preferred(key, best.key))) best = { value: total, key };
  }
  return best.value < F(fallback * F(0.99)) ? best.key : def;
}
function preferred(a, b) {
  const da = Math.abs(a[0]) + Math.abs(a[1]), db = Math.abs(b[0]) + Math.abs(b[1]);
  if (da !== db) return da < db;
  return a[1] !== b[1] ? a[1] < b[1] : a[0] < b[0];
}

function extendSampleEdges(bytes, width, height, shift) {
  const stride = width * 4;
  const firstX = Math.max(0, shift[0]), lastX = Math.min(width - 1, width - 1 + shift[0]);
  const firstY = Math.max(0, -shift[1]), lastY = Math.min(height - 1, height - 1 - shift[1]);
  if (shift[0] !== 0) {
    for (let y = firstY; y <= lastY; y++) {
      const row = y * stride;
      for (let x = 0; x < firstX; x++) bytes.copyWithin(row + x * 4, row + firstX * 4, row + firstX * 4 + 4);
      for (let x = lastX + 1; x < width; x++) bytes.copyWithin(row + x * 4, row + lastX * 4, row + lastX * 4 + 4);
    }
  }
  for (let y = 0; y < firstY; y++) bytes.copyWithin(y * stride, firstY * stride, firstY * stride + stride);
  for (let y = lastY + 1; y < height; y++) bytes.copyWithin(y * stride, lastY * stride, lastY * stride + stride);
}

/** PixelConverter.convert (게임 스프라이트·배경 지우기·세밀·베리 잉크·얇은 잉크 고정) */
/** prepared: withoutLightBackground를 거친 원본(맥판은 같은 계산을 세 번 하지만 결과가 같아 한 번만 한다) */
export function convertBerry(prepared, size, colors, gridOffset) {
  const fitted = fit(prepared.w, prepared.h, size.w, size.h);
  const side = 4;
  const sampledW = fitted.w * side, sampledH = fitted.h * side;
  const shift = [Math.max(-2, Math.min(2, gridOffset[0])), Math.max(-2, Math.min(2, gridOffset[1]))];
  const bytes = rasterize(prepared, sampledW, sampledH, { x: shift[0], y: shift[1], w: sampledW, h: sampledH });
  if (shift[0] !== 0 || shift[1] !== 0) extendSampleEdges(bytes, sampledW, sampledH, shift);
  const width = fitted.w, height = fitted.h;
  const { pixels, palette, labels } = spritePixels(bytes, sampledW * 4, width, height, colors);
  const encoded = palette.map(encodeSRGB);
  const out = new Uint8Array(size.w * size.h * 4);
  const xOffset = fitted.x, yOffset = fitted.top;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const pixel = pixels[y * width + x];
    const alpha = roundAway(F(pixel.alpha * 255));
    if (!(alpha > 0) || palette.length === 0) continue;
    const rgb = encoded[labels[y * width + x]];
    const o = ((y + yOffset) * size.w + x + xOffset) * 4;
    out[o] = Math.floor((rgb[0] * alpha + 127) / 255);
    out[o + 1] = Math.floor((rgb[1] * alpha + 127) / 255);
    out[o + 2] = Math.floor((rgb[2] * alpha + 127) / 255);
    out[o + 3] = alpha;
  }
  return { w: size.w, h: size.h, data: out };
}

const K_DARK = F(0.49), K_DARKS = F(0.23), K035 = F(0.35), K009 = F(0.09), K046 = F(0.46), K0034 = F(0.034);
const K092 = F(0.92), K0045 = F(0.045), K0965 = F(0.965), K0022 = F(0.022), K072 = F(0.72), K01 = F(0.1), K056 = F(0.56);
const K058 = F(0.58), K090 = F(0.90);

/** PixelConverter.choosePixels — 칸마다 4×4 표본에서 대표 색을 고른다(가운데 표본에 가중치, 가는 진한 선 우대). */
const CENTER = [1, F(1.4), F(1.4), 1];
function choosePixels(bytes, stride, width, height) {
  const side = 4, sampleCount = F(side * side);
  const result = Array.from({ length: width * height }, () => ({ color: ZERO(), alpha: 0, detail: 0 }));
  const samples = Array.from({ length: side * side }, () => ({ color: ZERO(), weight: 0 }));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let m0 = 0, m1 = 0, m2 = 0, sum = 0, alphaSum = 0, peakAlpha = 0;
      for (let sy = 0; sy < side; sy++) {
        const start = (y * side + sy) * stride + x * side * 4;
        for (let sx = 0; sx < side; sx++) {
          const offset = start + sx * 4, alphaByte = bytes[offset + 3], index = sy * side + sx;
          samples[index].weight = 0;
          if (alphaByte === 0) continue;
          const alpha = F(alphaByte / 255);
          const color = decodeLab(bytes[offset], bytes[offset + 1], bytes[offset + 2], alphaByte);
          const weight = F(F(alpha * CENTER[sx]) * CENTER[sy]);
          samples[index] = { color, weight };
          m0 = F(m0 + F(color[0] * weight)); m1 = F(m1 + F(color[1] * weight)); m2 = F(m2 + F(color[2] * weight));
          sum = F(sum + weight);
          alphaSum = F(alphaSum + alpha);
          peakAlpha = Math.max(peakAlpha, alpha);
        }
      }
      if (!(sum > 0)) continue;
      const coverage = F(alphaSum / sampleCount);
      const mean = [F(m0 / sum), F(m1 / sum), F(m2 / sum)];
      let alpha = coverage;
      // 불투명한 실루엣은 딱 잘라 정하고, 반투명 재질은 알파를 남긴다.
      if (peakAlpha >= F(0.98) && coverage < F(0.995)) alpha = coverage >= F(0.43) ? 1 : F(coverage * F(0.32));
      const representative = chooseColor(samples, mean, sum, true);
      result[y * width + x] = { color: representative.color, alpha, detail: representative.detail };
    }
  }
  return result;
}

function chooseColor(samples, mean, totalWeight, favorDarkStrokes) {
  let variation = 0;
  for (const s of samples) if (s.weight > 0) variation = Math.max(variation, dist2(s.color, mean));
  if (!(variation > F(0.005))) return { color: mean, detail: 0 };
  let bestScore = -Infinity, best = mean;
  for (const candidate of samples) {
    if (!(candidate.weight > 0)) continue;
    let support = 0;
    for (const other of samples) {
      if (!(other.weight > 0)) continue;
      const affinity = Math.max(0, F(1 - F(dist2(candidate.color, other.color) / F(0.008))));
      support = F(support + F(other.weight * affinity));
    }
    const fraction = F(support / totalWeight);
    const darker = Math.max(0, F(mean[0] - candidate.color[0]));
    const stroke = favorDarkStrokes
      ? F(Math.min(F(0.68), F(darker * F(2.6))) * Math.min(1, Math.max(0, F(F(fraction - F(0.09)) / F(0.13))))) : 0;
    const score = F(F(fraction + stroke) - F(F(0.38) * dist2(candidate.color, mean)));
    if (score > bestScore) { bestScore = score; best = candidate.color; }
  }
  const strength = Math.min(1, F(F(variation - F(0.005)) / F(0.024)));
  return { color: vadd(mean, vmul(vsub(best, mean), strength)), detail: strength };
}

function buildPalette(pixels, count) {
  const bins = new Map();
  for (const pixel of pixels) {
    if (!(pixel.alpha > F(0.02))) continue;
    const l = roundAway(F(pixel.color[0] * 48));
    const a = roundAway(F(F(pixel.color[1] + F(0.5)) * 56));
    const b = roundAway(F(F(pixel.color[2] + F(0.5)) * 56));
    const key = (l << 12) | (a << 6) | b;
    const weight = F(pixel.alpha * F(1 + F(pixel.detail * F(0.55))));
    let bin = bins.get(key);
    if (!bin) bins.set(key, bin = { total: ZERO(), weight: 0 });
    bin.total = vadd(bin.total, vmul(pixel.color, weight));
    bin.weight = F(bin.weight + weight);
  }
  const swatches = [...bins.keys()].sort((x, y) => x - y).map(k => {
    const bin = bins.get(k);
    return { color: vdiv(bin.total, bin.weight), weight: F(Math.pow(bin.weight, F(0.65))) };
  });
  const first = firstMax(swatches, (x, y) => x.weight < y.weight);
  if (!first) { const p = pixels.find(q => q.alpha > 0); return p ? [p.color] : []; }
  if (!(swatches.length > count)) return swatches.map(s => s.color);
  const palette = [first.color];
  const distances = new Float32Array(swatches.length).fill(Infinity);
  while (palette.length < count) {
    const last = palette[palette.length - 1];
    let bestIndex = 0, bestScore = -1;
    for (let index = 0; index < swatches.length; index++) {
      distances[index] = Math.min(distances[index], dist2(swatches[index].color, last));
      const score = F(distances[index] * swatches[index].weight);
      if (score > bestScore) { bestIndex = index; bestScore = score; }
    }
    if (!(bestScore > 0)) break;
    palette.push(swatches[bestIndex].color);
  }
  for (let round = 0; round < 7; round++) {
    const clusters = palette.map(() => ({ total: ZERO(), weight: 0 }));
    for (const swatch of swatches) {
      const c = clusters[nearestLab(swatch.color, palette)];
      c.total = vadd(c.total, vmul(swatch.color, swatch.weight));
      c.weight = F(c.weight + swatch.weight);
    }
    clusters.forEach((c, index) => { if (c.weight > 0) palette[index] = vdiv(c.total, c.weight); });
  }
  return palette;
}

function nearestLab(color, palette) {
  let winner = 0, closest = Infinity;
  for (let index = 0; index < palette.length; index++) {
    const d = dist2(palette[index], color);
    if (d < closest) { closest = d; winner = index; }
  }
  return winner;
}

function spritePixels(bytes, stride, width, height, colors) {
  const side = 4, sampleCount = F(side * side);
  const n = width * height;
  const pixels = Array.from({ length: n }, () => ({ color: ZERO(), alpha: 0, detail: 0 }));
  const fillHues = Array.from({ length: n }, ZERO);
  const centers = new Float32Array(n), lightGaps = new Float32Array(n);
  // 합계는 배열 대신 성분별 숫자로 둔다(계산 순서·Float32 반올림은 맥판과 같다).
  let ink0 = 0, ink1 = 0, ink2 = 0, inkWeight = 0, white0 = 0, white1 = 0, white2 = 0, whiteWeight = 0;
  const fillSamples = Array.from({ length: side * side }, () => ({ color: ZERO(), weight: 0 }));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let alphaSum = 0, stroke = 0, centerInk = 0, lightGap = 0, fillWeight = 0;
      let f0 = 0, f1 = 0, f2 = 0, a0 = 0, a1 = 0, a2 = 0, w0 = 0, w1 = 0, w2 = 0, whiteCoverage = 0;
      let c0 = 0, c1 = 0, c2 = 0, chromaticCoverage = 0, chromaticWeight = 0;
      for (let sy = 0; sy < side; sy++) {
        for (let sx = 0; sx < side; sx++) {
          const offset = (y * side + sy) * stride + (x * side + sx) * 4;
          const alpha = bytes[offset + 3];
          const index = sy * side + sx;
          fillSamples[index].weight = 0;
          if (alpha === 0) continue;
          const coverage = F(alpha / 255);
          const color = decodeLab(bytes[offset], bytes[offset + 1], bytes[offset + 2], alpha);
          const ch = F(Math.abs(color[1]) + Math.abs(color[2]));
          const dark = F(Math.min(1, Math.max(0, F(F(K_DARK - color[0]) / K_DARKS))) * Math.max(K035, F(1 - F(4 * ch))));
          const weight = F(F(coverage * F(1 - dark)) * F(1 - dark));
          if (weight > K009) fillSamples[index] = { color, weight };
          alphaSum = F(alphaSum + coverage);
          stroke = F(stroke + F(coverage * dark));
          const strength = len2(color[1], color[2]);
          const L = color[0], P = color[1], Q = color[2];
          if (L >= K046 && strength >= K0034) {
            c0 = F(c0 + F(L * coverage)); c1 = F(c1 + F(P * coverage)); c2 = F(c2 + F(Q * coverage));
            chromaticCoverage = F(chromaticCoverage + coverage);
            chromaticWeight = F(chromaticWeight + F(strength * coverage));
          }
          if (sx >= 1 && sx <= 2 && sy >= 1 && sy <= 2) {
            centerInk = F(centerInk + F(coverage * dark));
            if (color[0] > K092 && ch < K0045) lightGap = F(lightGap + coverage);
          }
          f0 = F(f0 + F(L * weight)); f1 = F(f1 + F(P * weight)); f2 = F(f2 + F(Q * weight));
          fillWeight = F(fillWeight + weight);
          a0 = F(a0 + F(L * coverage)); a1 = F(a1 + F(P * coverage)); a2 = F(a2 + F(Q * coverage));
          if (dark >= K072) {
            ink0 = F(ink0 + F(F(L * dark) * coverage)); ink1 = F(ink1 + F(F(P * dark) * coverage)); ink2 = F(ink2 + F(F(Q * dark) * coverage));
            inkWeight = F(inkWeight + F(dark * coverage));
          }
          if (L > K0965 && ch < K0022) {
            w0 = F(w0 + F(L * coverage)); w1 = F(w1 + F(P * coverage)); w2 = F(w2 + F(Q * coverage));
            whiteCoverage = F(whiteCoverage + coverage);
          }
        }
      }
      if (!(alphaSum >= F(sampleCount * K046))) continue;
      let color = fillWeight > K01 ? vdiv([f0, f1, f2], fillWeight) : vdiv([a0, a1, a2], alphaSum);
      if (whiteCoverage >= Math.max(1, F(fillWeight * K056))) {
        color = vdiv([w0, w1, w2], whiteCoverage);
        white0 = F(white0 + w0); white1 = F(white1 + w1); white2 = F(white2 + w2);
        whiteWeight = F(whiteWeight + whiteCoverage);
      } else if (fillWeight > K01) {
        color = chooseColor(fillSamples, color, fillWeight, false).color;
      }
      const i = y * width + x;
      pixels[i] = { color, alpha: 1, detail: F(stroke / sampleCount) };
      centers[i] = F(centerInk / 4);
      lightGaps[i] = F(lightGap / 4);
      if (chromaticCoverage >= F(sampleCount * K058) && len2(c1, c2) >= F(chromaticWeight * K090)) {
        fillHues[i] = vdiv([c0, c1, c2], chromaticCoverage);
      }
    }
  }
  const opaque = [];
  for (let i = 0; i < n; i++) if (pixels[i].alpha > 0) opaque.push(i);
  if (opaque.length === 0) return { pixels, palette: [], labels: null };

  const neighbors = (i, diagonals = false) => {
    const x = i % width, y = (i / width) | 0, out = [];
    for (let v = Math.max(0, y - 1); v <= Math.min(height - 1, y + 1); v++) for (let u = Math.max(0, x - 1); u <= Math.min(width - 1, x + 1); u++) {
      if ((u !== x || v !== y) && (diagonals || u === x || v === y)) out.push(v * width + u);
    }
    return out;
  };
  const strokes = new Array(n).fill(false);
  if (inkWeight > 0) {
    for (const i of opaque) {
      const edge = neighbors(i).some(j => pixels[j].alpha === 0);
      const coverage = pixels[i].detail;
      if (!edge) {
        const protectedGap = lightGaps[i] >= K072 && centers[i] < F(0.20);
        const concentrated = centers[i] >= K058 && coverage >= F(0.25);
        strokes[i] = coverage >= F(0.57) || (!protectedGap && (coverage >= K035 || concentrated));
      } else {
        strokes[i] = coverage >= (edge ? F(0.17) : K035);
      }
    }
    const core = strokes.slice();
    for (const i of opaque) {
      if (core[i] || !(pixels[i].detail >= F(0.23))) continue;
      if (lightGaps[i] >= K072 && centers[i] < F(0.20)) continue;
      const adjoining = neighbors(i, true).filter(j => core[j]);
      const x = i % width, y = (i / width) | 0;
      strokes[i] = adjoining.some(a => adjoining.some(b => (a % width - x) * (b % width - x) + (((a / width) | 0) - y) * (((b / width) | 0) - y) < 0));
    }
  }
  const isWhiteLab = c => c[0] > K0965 && F(Math.abs(c[1]) + Math.abs(c[2])) < K0022;
  if (width > 1 && height > 1) {
    for (let y = 0; y < height - 1; y++) {
      for (let x = 0; x < width - 1; x++) {
        const first = y * width + x;
        const block = [first, first + 1, first + width, first + width + 1];
        if (!block.every(j => strokes[j])) continue;
        const i = firstMin(block, (a, b) => pixels[a].detail < pixels[b].detail);
        if (!(pixels[i].detail < F(0.62))) continue;
        const around = neighbors(i, true);
        const adjacentFill = around.filter(j => !strokes[j]);
        if (!(adjacentFill.length >= 2 && adjacentFill.every(j => {
          const p = pixels[j];
          return p.alpha > 0 && p.color[0] > F(0.85) && F(Math.abs(p.color[1]) + Math.abs(p.color[2])) < F(0.10);
        }))) continue;
        const whiteCount = adjacentFill.filter(j => isWhiteLab(pixels[j].color)).length;
        if (!(whiteCount * 2 < adjacentFill.length)) continue;
        const connected = around.filter(j => strokes[j]);
        const reached = new Set(connected.slice(0, 1));
        for (let k = 0; k < connected.length; k++) {
          const previous = new Set(reached);
          for (const j of connected) {
            if (previous.has(j)) continue;
            for (const q of previous) {
              if (Math.abs(q % width - j % width) <= 1 && Math.abs(((q / width) | 0) - ((j / width) | 0)) <= 1) { reached.add(j); break; }
            }
          }
          if (previous.size === reached.size) break;
        }
        if (reached.size === connected.length) {
          strokes[i] = false;
          let sum = ZERO();
          for (const j of adjacentFill) sum = vadd(sum, pixels[j].color);
          pixels[i].color = vdiv(sum, adjacentFill.length);
        }
      }
    }
  }
  thinSpriteInk(strokes, pixels, width, height, isWhiteLab);
  const hasInk = strokes.includes(true);
  const hasWhite = whiteWeight >= sampleCount && (!hasInk || colors > 2);
  let palette = [];
  if (hasInk) palette.push(vdiv([ink0, ink1, ink2], inkWeight));
  const whiteIndex = hasWhite ? palette.length : -1;
  if (hasWhite) palette.push(vdiv([white0, white1, white2], whiteWeight));
  const fillStart = palette.length;
  const fills = [];
  for (const i of opaque) {
    if (strokes[i] || (hasWhite && !(dist2(pixels[i].color, palette[whiteIndex]) > F(0.00034)))) continue;
    fills.push({ color: pixels[i].color, alpha: pixels[i].detail < K01 ? 1 : F(0.12), detail: 0 });
  }
  if (fillStart < colors) palette = palette.concat(buildPalette(fills, colors - fillStart));
  const labels = new Int32Array(n).fill(-1);
  const fillPalette = palette.slice(hasInk && palette.length > 1 ? 1 : 0);
  const fillOffset = palette.length - fillPalette.length;
  for (const i of opaque) labels[i] = strokes[i] ? 0 : nearestLab(pixels[i].color, fillPalette) + fillOffset;

  const initial = labels.slice();
  for (const i of opaque) {
    const label = initial[i];
    if (label === whiteIndex || (hasInk && label === 0)) continue;
    const adjacent = neighbors(i), surrounding = neighbors(i, true);
    const votes = new Array(palette.length).fill(0);
    for (const j of surrounding) {
      const candidate = initial[j];
      if (candidate >= fillOffset) votes[candidate] += adjacent.includes(j) ? 2 : 1;
    }
    if (votes.length === 0) continue;
    let best = 0;
    for (let k = 1; k < votes.length; k++) if (votes[best] < votes[k]) best = k;
    const whiteFringe = best === whiteIndex && votes[best] >= 4 && votes[label] <= 2 &&
      adjacent.every(j => initial[j] === label || initial[j] === whiteIndex || initial[j] < fillOffset);
    const isolated = votes[label] <= 1 && votes[best] >= 6;
    if (whiteFringe || isolated) labels[i] = best;
  }
  if (hasWhite) blendSmallPalePatches(labels, palette, whiteIndex, width, height, hasInk);
  keepFillHues(labels, palette, fillHues, width, height, fillOffset);
  palette = palette.map((c, index) => berrySwatch(c, hasInk && index === 0));
  return { pixels, palette, labels };
}

function keepFillHues(labels, palette, evidence, width, height, fillOffset) {
  const strengths = palette.map(c => len2(c[1], c[2]));
  const initial = labels.slice();
  const K077 = F(0.77), K026 = F(0.026), K016 = F(0.16);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x, source = evidence[i], label = initial[i];
      if (!(label >= fillOffset && source[0] > 0)) continue;
      const strength = len2(source[1], source[2]);
      const matches = c => strengths[c] >= K026 &&
        F(F(source[1] * palette[c][1]) + F(source[2] * palette[c][2])) >= F(F(K077 * strength) * strengths[c]);
      if (matches(label)) continue;
      let best = label, bestDistance = Infinity, supporting = 0;
      for (let v = Math.max(0, y - 1); v <= Math.min(height - 1, y + 1); v++) {
        for (let u = Math.max(0, x - 1); u <= Math.min(width - 1, x + 1); u++) {
          const candidate = initial[v * width + u];
          if (!(candidate >= fillOffset && matches(candidate) && Math.abs(F(source[0] - palette[candidate][0])) < K016)) continue;
          supporting++;
          const d = dist2(source, palette[candidate]);
          if (d < bestDistance) { bestDistance = d; best = candidate; }
        }
      }
      if (supporting >= 2) labels[i] = best;
    }
  }
}

function thinSpriteInk(strokes, pixels, width, height, isWhiteLab) {
  if (!(width > 2 && height > 2)) return;
  const ring = [-width, 1 - width, 1, 1 + width, width, width - 1, -1, -1 - width];
  const candidates = [];
  for (let i = 0; i < strokes.length; i++) {
    const x = i % width, y = (i / width) | 0;
    if (x > 0 && x + 1 < width && y > 0 && y + 1 < height && strokes[i] && pixels[i].detail < F(0.82)) candidates.push(i);
  }
  candidates.sort((a, b) => pixels[a].detail - pixels[b].detail);
  const originalStrokes = strokes.slice();
  for (let pass = 0; pass < 2; pass++) {
    for (const i of candidates) {
      if (!strokes[i]) continue;
      const nb = ring.map(o => i + o);
      const sides = [nb[0], nb[2], nb[4], nb[6]];
      if (!sides.every(j => pixels[j].alpha > 0)) continue;
      if (sides.filter(j => strokes[j]).length > 2) continue;
      const fill = sides.filter(j => !originalStrokes[j]);
      if (fill.length === 0) continue;
      const r = nb.map(j => strokes[j]);
      if (r.filter(Boolean).length < 3) continue;
      let entries = 0;
      for (let k = 0; k < 8; k++) if (!r[k] && r[(k + 1) % 8]) entries++;
      if (entries !== 1) continue;
      const color = pixels[i].color;
      const white = fill.filter(j => isWhiteLab(pixels[j].color));
      if (white.length >= 2 && white.length === fill.length) continue;
      const replacement = white.length >= 2 ? white[0] : firstMin(fill, (a, b) => dist2(color, pixels[a].color) < dist2(color, pixels[b].color));
      if (replacement !== undefined) { pixels[i].color = pixels[replacement].color; strokes[i] = false; }
    }
  }
}

function berrySwatch(c, isInk) {
  if (isInk) return [Math.max(F(0.257), Math.min(c[0], F(0.33))), F(0.043), F(-0.042)];
  const chromaV = F(Math.sqrt(F(F(c[1] * c[1]) + F(c[2] * c[2]))));
  const strength = Math.min(1, Math.max(0, F(F(chromaV - F(0.017)) / F(0.038))));
  const shadow = Math.min(1, Math.max(0, F(F(F(0.87) - c[0]) / F(0.40))));
  const violet = c[1] > F(0.018) && c[2] < F(-0.022) && -c[2] > F(c[1] * F(0.5));
  const pinkLab = c[1] > F(0.035) && Math.abs(c[2]) <= F(c[1] * F(0.5));
  let delta;
  if (violet) delta = [F(F(c[0] - F(0.67)) * F(0.16)), F(c[1] * F(0.13)), F(F(c[2] * F(0.35)) - F(0.007))];
  else if (pinkLab) delta = [F(F(c[0] - F(0.77)) * F(0.12)), F(F(c[1] * F(0.17)) + F(0.008)), F(F(-0.007) - F(F(0.017) * shadow))];
  else delta = [0, F(F(c[1] * F(0.15)) + F(F(0.012) * shadow)), F(F(c[2] * F(0.15)) - F(F(0.016) * shadow))];
  return vadd(c, vmul(delta, strength));
}

function blendSmallPalePatches(labels, palette, whiteIndex, width, height, skipInk) {
  const pale = [];
  for (let k = 0; k < palette.length; k++) {
    if (k !== whiteIndex && (!skipInk || k !== 0) && palette[k][0] >= F(0.88) && dist2(palette[k], palette[whiteIndex]) < F(0.005)) pale.push(k);
  }
  if (pale.length === 0) return;
  const possible = new Set(pale);
  const visited = new Uint8Array(labels.length);
  const patches = [];
  let big = 0;
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] !== whiteIndex || visited[i]) continue;
    const cells = [i];
    visited[i] = 1;
    let touchesExterior = false;
    const contacts = new Array(palette.length).fill(0);
    for (let head = 0; head < cells.length; head++) {
      const j = cells[head], x = j % width, y = (j / width) | 0;
      for (const [u, v] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (u < 0 || u >= width || v < 0 || v >= height) { touchesExterior = true; continue; }
        const nIdx = v * width + u, color = labels[nIdx];
        if (color === whiteIndex) { if (!visited[nIdx]) { visited[nIdx] = 1; cells.push(nIdx); } }
        else if (color < 0) touchesExterior = true;
        else if (!skipInk || color !== 0) contacts[color]++;
      }
    }
    big = Math.max(big, cells.length);
    let best = 0;
    for (let k = 1; k < contacts.length; k++) if (contacts[best] < contacts[k]) best = k;
    const total = contacts.reduce((s, c) => s + c, 0);
    const replacement = contacts.length && !touchesExterior && possible.has(best) && contacts[best] >= 4 && contacts[best] * 3 >= total * 2 ? best : null;
    patches.push({ cells, replacement });
  }
  const limit = Math.min(Math.floor(big / 4), Math.max(4, Math.floor(labels.length / 40)));
  for (const patch of patches) {
    if (patch.cells.length <= limit && patch.replacement !== null) for (const i of patch.cells) labels[i] = patch.replacement;
  }
}

// ── 원본 대조 보정
const isDarkLab = c => { const ch = len2(c[1], c[2]); return (c[0] < F(0.42) && ch < F(0.06)) || (c[0] < K035 && ch < F(0.12)); };

function commonest(points) {
  // 칸 번호 (x, y, z)를 숫자 하나로: 사전 순서와 숫자 크기 순서가 같다(각 성분 ±512 안쪽).
  const bins = new Map();
  for (const p of points) {
    const key = ((roundAway(F(p[0] / F(0.04))) + 512) * 1024 + roundAway(F(p[1] / F(0.03))) + 512) * 1024 + roundAway(F(p[2] / F(0.03))) + 512;
    let bin = bins.get(key);
    if (!bin) bins.set(key, bin = { t0: 0, t1: 0, t2: 0, count: 0 });
    bin.t0 = F(bin.t0 + p[0]); bin.t1 = F(bin.t1 + p[1]); bin.t2 = F(bin.t2 + p[2]);
    bin.count++;
  }
  let best = null, bestKey = 0;
  for (const [key, bin] of bins) {
    if (!best || bin.count > best.count || (bin.count === best.count && key < bestKey)) { best = bin; bestKey = key; }
  }
  return [F(best.t0 / best.count), F(best.t1 / best.count), F(best.t2 / best.count)];
}

function evidenceFor(prepared, size, shift) {
  const f = fit(prepared.w, prepared.h, size.w, size.h);
  const w = f.w, h = f.h, side = 8;
  const frame = { width: w, height: h, xOffset: Math.trunc((size.w - w) / 2), yOffset: Math.trunc((size.h - h) / 2) };
  const bytes = rasterize(prepared, w * side, h * side, { x: shift[0] * 2, y: shift[1] * 2, w: w * side, h: h * side });
  const stride = w * side * 4;
  const dark = new Float32Array(w * h), color = Array.from({ length: w * h }, ZERO), opaque = new Array(w * h).fill(false);
  const samples = Array.from({ length: w * h }, () => []);
  for (let cy = 0; cy < h; cy++) {
    for (let cx = 0; cx < w; cx++) {
      const points = [], sparse = [];
      for (let sy = 0; sy < side; sy++) for (let sx = 0; sx < side; sx++) {
        const o = (cy * side + sy) * stride + (cx * side + sx) * 4, alpha = bytes[o + 3];
        if (!(alpha > 127)) continue;
        const lab = decodeLab(bytes[o], bytes[o + 1], bytes[o + 2], alpha);
        points.push(lab);
        if (sx % 2 === 0 && sy % 2 === 0) sparse.push(lab);
      }
      const i = cy * w + cx;
      const coverage = F(points.length / (side * side));
      opaque[i] = coverage >= F(0.5);
      if (points.length === 0) continue;
      const darkPoints = points.filter(isDarkLab);
      dark[i] = F(F(darkPoints.length / points.length) * coverage);
      const body = points.length - darkPoints.length >= 4 ? points.filter(p => !isDarkLab(p)) : points;
      color[i] = commonest(body);
      samples[i] = sparse;
    }
  }
  return { frame, dark, color, opaque, samples };
}

function correctLabels(labels, palette, evidence, summary) {
  const w = evidence.frame.width, h = evidence.frame.height;
  const result = labels.slice();
  if (palette.length === 0 || labels.length !== w * h) return labels;
  const inkCandidates = palette.map((_, i) => i).filter(i => isDarkLab(palette[i]));
  const ink = firstMin(inkCandidates, (a, b) => palette[a][0] < palette[b][0]);
  const sums = palette.map(ZERO), counts = new Array(palette.length).fill(0);
  for (let i = 0; i < labels.length; i++) if (labels[i] >= 0 && evidence.opaque[i]) { sums[labels[i]] = vadd(sums[labels[i]], evidence.color[i]); counts[labels[i]]++; }
  const meaning = palette.map((c, i) => (counts[i] > 0 ? vdiv(sums[i], counts[i]) : c));
  const label = (x, y) => (x >= 0 && x < w && y >= 0 && y < h ? labels[y * w + x] : -1);
  if (ink !== undefined) {
    const line = (x, y) => label(x, y) === ink;
    const pairs = [[[-1, 0], [1, 0]], [[0, -1], [0, 1]], [[-1, -1], [1, 1]], [[-1, 1], [1, -1]]];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!(labels[i] >= 0 && labels[i] !== ink)) continue;
      const f = evidence.dark[i];
      const bridge = pairs.some(([a, b]) => line(x + a[0], y + a[1]) && line(x + b[0], y + b[1]));
      const block = [[-1, -1], [-1, 1], [1, -1], [1, 1]].some(([dx, dy]) => line(x + dx, y) && line(x, y + dy) && line(x + dx, y + dy));
      if (f >= F(0.5) || (f >= F(0.18) && bridge && !block)) { result[i] = ink; summary.restoredLines++; }
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!(labels[i] === ink && evidence.dark[i] < F(0.03) && evidence.opaque[i])) continue;
      const candidates = new Set();
      for (let v = Math.max(0, y - 1); v <= Math.min(h - 1, y + 1); v++) for (let u = Math.max(0, x - 1); u <= Math.min(w - 1, x + 1); u++) {
        const l = labels[v * w + u];
        if (l >= 0 && l !== ink) candidates.add(l);
      }
      const best = firstMin([...candidates].sort((a, b) => a - b), (a, b) => vdist(meaning[a], evidence.color[i]) < vdist(meaning[b], evidence.color[i]));
      if (best !== undefined) { result[i] = best; summary.removedLines++; }
    }
  }
  const fills = palette.map((_, i) => i).filter(i => i !== ink);
  for (let i = 0; i < result.length; i++) {
    const current = result[i];
    if (!(current >= 0 && current !== ink && evidence.dark[i] < K035 && evidence.opaque[i] && fills.length > 0)) continue;
    const c = evidence.color[i];
    if (!(vdist(meaning[current], c) > F(0.10))) continue;
    const points = evidence.samples[i];
    const present = points.length === 0 ? 0 : F(points.filter(p => vdist(p, meaning[current]) < F(0.08)).length / points.length);
    if (!(present < F(0.2))) continue;
    const best = firstMin(fills, (a, b) => vdist(meaning[a], c) < vdist(meaning[b], c));
    if (best !== current && vdist(meaning[best], c) <= F(0.07)) { result[i] = best; summary.fixedColors++; }
  }
  return result;
}

function sourceCheck(conversion, prepared, size, shift) {
  const evidence = evidenceFor(prepared, size, shift);
  const f = evidence.frame;
  const bytes = conversion.data.slice();
  const keys = new Map(), palette = [], rgbOf = [];
  const labels = new Int32Array(f.width * f.height).fill(-1);
  for (let cy = 0; cy < f.height; cy++) for (let cx = 0; cx < f.width; cx++) {
    const o = ((cy + f.yOffset) * size.w + cx + f.xOffset) * 4, alpha = bytes[o + 3];
    if (!(alpha > 127)) continue;
    const rgb = [0, 1, 2].map(k => Math.min(255, Math.floor((bytes[o + k] * 255 + (alpha >> 1)) / alpha)));
    const key = (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];
    if (!keys.has(key)) { keys.set(key, palette.length); palette.push(decodeLab(rgb[0], rgb[1], rgb[2], 255)); rgbOf.push(rgb); }
    labels[cy * f.width + cx] = keys.get(key);
  }
  const summary = { restoredLines: 0, removedLines: 0, fixedColors: 0 };
  const fixed = correctLabels(labels, palette, evidence, summary);
  if (summary.restoredLines + summary.removedLines + summary.fixedColors === 0) return conversion;
  for (let i = 0; i < fixed.length; i++) {
    if (fixed[i] === labels[i] || fixed[i] < 0) continue;
    const o = (((i / f.width) | 0) + f.yOffset) * size.w * 4 + (i % f.width + f.xOffset) * 4, rgb = rgbOf[fixed[i]];
    bytes[o] = rgb[0]; bytes[o + 1] = rgb[1]; bytes[o + 2] = rgb[2]; bytes[o + 3] = 255;
  }
  return { w: conversion.w, h: conversion.h, data: bytes };
}

// ── 선 1px로 다듬기
const SIDES = [[-1, 0], [1, 0], [0, -1], [0, 1]];
function corners(isLine, prot, w, h, passes = 2) {
  const line = isLine.slice(), removed = new Array(w * h).fill(false);
  const on = (x, y) => x >= 0 && x < w && y >= 0 && y < h && line[y * w + x];
  const lineNeighbours = (x, y, ex, ey) => {
    let c = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if ((dx === 0 && dy === 0) || (x + dx === ex && y + dy === ey)) continue;
      if (on(x + dx, y + dy)) c++;
    }
    return c;
  };
  for (let pass = 0; pass < passes; pass++) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!line[y * w + x] || prot[y * w + x]) continue;
      const near = SIDES.filter(([dx, dy]) => on(x + dx, y + dy));
      if (!(near.length === 2 && near[0][0] + near[1][0] !== 0 && near[0][1] + near[1][1] !== 0)) continue;
      if (!near.every(([dx, dy]) => lineNeighbours(x + dx, y + dy, x, y) >= 2)) continue;
      line[y * w + x] = false;
      removed[y * w + x] = true;
    }
  }
  return removed;
}
function outerBand(isLine, opaque, outside, w, h) {
  return isLine.map((l, i) => {
    if (!l || outside[i]) return false;
    const x = i % w, y = (i / w) | 0;
    return SIDES.some(([dx, dy]) => {
      const ox = x + dx, oy = y + dy, ix = x - dx, iy = y - dy;
      if (ox < 0 || ox >= w || oy < 0 || oy >= h || ix < 0 || ix >= w || iy < 0 || iy >= h) return false;
      const o = oy * w + ox, nIdx = iy * w + ix;
      return isLine[o] && outside[o] && opaque[nIdx] && !isLine[nIdx];
    });
  });
}
function touchesOutside(opaque, w, h) {
  return opaque.map((op, i) => {
    const x = i % w, y = (i / w) | 0;
    return op && SIDES.some(([dx, dy]) => x + dx < 0 || x + dx >= w || y + dy < 0 || y + dy >= h || !opaque[(y + dy) * w + x + dx]);
  });
}
const keyAt = (bytes, i) => (bytes[i * 4] << 16) | (bytes[i * 4 + 1] << 8) | bytes[i * 4 + 2];
/** 같은 개수면 색 번호가 작은 쪽 */
function bestVote(votes) {
  let best = null;
  for (const [k, v] of votes) if (!best || v.n > best.v.n || (v.n === best.v.n && k < best.k)) best = { k, v };
  return best;
}

function pixelPerfect(conversion) {
  const { w, h } = conversion, bytes = conversion.data.slice(), count = w * h;
  const opaque = Array.from({ length: count }, (_, i) => bytes[i * 4 + 3] > 127);
  let darkest = null;
  for (let i = 0; i < count; i++) {
    if (!opaque[i]) continue;
    const l = labAt(bytes, i, bytes[i * 4 + 3])[0];
    if (l < (darkest?.light ?? 2)) darkest = { key: keyAt(bytes, i), light: l };
  }
  if (!darkest || !(darkest.light < K035)) return conversion;
  const inked = opaque.map((o, i) => o && keyAt(bytes, i) === darkest.key);
  const isLine = inked.map((ink, i) => {
    if (!ink) return false;
    const x = i % w, y = (i / w) | 0;
    let dark = 0, cells = 0;
    for (let v = Math.max(0, y - 2); v <= Math.min(h - 1, y + 2); v++) for (let u = Math.max(0, x - 2); u <= Math.min(w - 1, x + 2); u++) { cells++; if (inked[v * w + u]) dark++; }
    return dark * 2 <= cells;
  });
  const outside = touchesOutside(opaque, w, h);
  const band = outerBand(isLine, opaque, outside, w, h);
  const thinned = isLine.map((l, i) => l && !band[i]);
  const cut = corners(thinned, outside, w, h);
  const before = bytes.slice();
  let changed = 0;
  for (let i = 0; i < count; i++) {
    if (!(band[i] || cut[i])) continue;
    const x = i % w, y = (i / w) | 0, votes = new Map();
    for (let v = Math.max(0, y - 1); v <= Math.min(h - 1, y + 1); v++) for (let u = Math.max(0, x - 1); u <= Math.min(w - 1, x + 1); u++) {
      const j = v * w + u;
      if (!opaque[j] || isLine[j]) continue;
      const k = keyAt(before, j), e = votes.get(k);
      if (e) e.n++; else votes.set(k, { n: 1, at: j });
    }
    const best = bestVote(votes);
    if (!best) continue;
    bytes.set(before.subarray(best.v.at * 4, best.v.at * 4 + 4), i * 4);
    changed++;
  }
  return changed > 0 ? { w, h, data: bytes } : conversion;
}

// ── 바깥 테두리를 순검정 1px로
export function flatOutline(conversion) {
  const { w, h } = conversion, bytes = conversion.data.slice(), count = w * h, SMALL = 12;
  for (let i = 0; i < count; i++) {
    const alpha = bytes[i * 4 + 3];
    if (alpha >= 255) continue;
    for (let c = 0; c < 3; c++) bytes[i * 4 + c] = alpha > 127 ? Math.min(255, Math.floor((bytes[i * 4 + c] * 255 + (alpha >> 1)) / alpha)) : 0;
    bytes[i * 4 + 3] = alpha > 127 ? 255 : 0;
  }
  const opaque = Array.from({ length: count }, (_, i) => bytes[i * 4 + 3] > 127);
  const isOpaque = (x, y) => x >= 0 && x < w && y >= 0 && y < h && opaque[y * w + x];
  const neighbors = i => {
    const out = [], x = i % w, y = (i / w) | 0;
    for (const [dx, dy] of SIDES) if (isOpaque(x + dx, y + dy)) out.push((y + dy) * w + x + dx);
    return out;
  };
  const key = i => keyAt(bytes, i);
  const setOpaque = (i, j) => { for (let c = 0; c < 3; c++) bytes[i * 4 + c] = bytes[j * 4 + c]; bytes[i * 4 + 3] = 255; opaque[i] = true; };
  const clear = i => { bytes.fill(0, i * 4, i * 4 + 4); opaque[i] = false; };

  const piece = new Int32Array(count).fill(-1), pieceSize = [];
  for (let start = 0; start < count; start++) {
    if (!opaque[start] || piece[start] >= 0) continue;
    const id = pieceSize.length, stack = [start];
    let size = 0;
    piece[start] = id;
    while (stack.length) {
      const i = stack.pop();
      size++;
      for (const j of neighbors(i)) if (piece[j] < 0) { piece[j] = id; stack.push(j); }
    }
    pieceSize.push(size);
  }
  const small = i => piece[i] >= 0 && pieceSize[piece[i]] <= SMALL;

  for (let i = 0; i < count; i++) if (opaque[i] && !small(i) && neighbors(i).length <= 1) clear(i);
  for (let i = 0; i < count; i++) {
    if (opaque[i]) continue;
    const around = neighbors(i);
    if (around.length >= 3 && !around.some(small)) { setOpaque(i, around[0]); piece[i] = piece[around[0]]; }
  }
  const edge = Array.from({ length: count }, (_, i) => (opaque[i] ? !small(i) && neighbors(i).length < 4 : neighbors(i).some(small)));
  for (let i = 0; i < count; i++) {
    if (!(opaque[i] && edge[i] && !small(i))) continue;
    const around = neighbors(i);
    if (!(around.length === 2 && around.every(j => edge[j]) && Math.abs(around[0] - around[1]) !== 2 && Math.abs(around[0] - around[1]) !== 2 * w)) continue;
    clear(i);
    edge[i] = false;
  }
  const edgeColors = new Map();
  for (let i = 0; i < count; i++) if (opaque[i] && edge[i]) edgeColors.set(key(i), (edgeColors.get(key(i)) ?? 0) + 1);
  let ink = null;
  for (const [k, v] of edgeColors) if (!ink || v > ink.v || (v === ink.v && k < ink.k)) ink = { k, v };
  const inkKey = ink?.k;
  const lab = i => labAt(bytes, i, 255);
  const lineLike = i => { if (key(i) === inkKey) return true; const c = lab(i); return c[0] < F(0.32) && len2(c[1], c[2]) < F(0.07); };
  let ring = edge.slice();
  for (let pass = 0; pass < 2; pass++) {
    const before = bytes.slice(), next = ring.slice();
    for (let i = 0; i < count; i++) {
      if (!opaque[i] || ring[i]) continue;
      const x = i % w, y = (i / w) | 0;
      if (!neighbors(i).some(j => ring[j])) continue;
      const own = key(i), votes = new Map();
      for (let v = Math.max(0, y - 1); v <= Math.min(h - 1, y + 1); v++) for (let u = Math.max(0, x - 1); u <= Math.min(w - 1, x + 1); u++) {
        const j = v * w + u;
        if (!opaque[j] || ring[j] || lineLike(j) || key(j) === own) continue;
        const e = votes.get(key(j));
        if (e) e.n++; else votes.set(key(j), { n: 1, at: j });
      }
      const best = bestVote(votes);
      if (!best) continue;
      if (!(lineLike(i) || lab(i)[0] < F(lab(best.v.at)[0] - F(0.12)))) continue;
      for (let c = 0; c < 3; c++) bytes[i * 4 + c] = before[best.v.at * 4 + c];
      next[i] = true;
    }
    ring = next;
  }
  for (let i = 0; i < count; i++) if (edge[i]) { bytes[i * 4] = 0; bytes[i * 4 + 1] = 0; bytes[i * 4 + 2] = 0; bytes[i * 4 + 3] = 255; }
  return { w, h, data: bytes };
}

// ── 베리 잉크 전체
export function renderBerry(subject, w, h, settings, lines = null) {
  const image = subject.image();
  const size = { w, h };
  const prepared = withoutLightBackground(image);
  const aligned = bestGrid(prepared, size);
  const offset = [aligned[0], -aligned[1]];
  let conversion = convertBerry(prepared, size, Math.max(2, Math.min(64, settings.colors - (settings.boundary ? 2 : 1))), offset);
  const shift = [Math.max(-2, Math.min(2, offset[0])), Math.max(-2, Math.min(2, offset[1]))];
  conversion = sourceCheck(conversion, prepared, size, shift);
  conversion = pixelPerfect(conversion);
  return finishLegacy(conversion, settings, lines);
}

function finishLegacy(converted, settings, lines) {
  const conversion = flatOutline(converted);
  const raster = Raster.fromPremultiplied(conversion.data, conversion.w, conversion.h);
  const grid = raster.grid;
  const mask = Array.from(raster.px, p => A(p) > 0);
  const outline = Array.from(grid.depths(mask), d => d === 1);
  if (settings.width === 2) {
    const inner = [];
    for (let i = 0; i < grid.count; i++) {
      if (!mask[i] || outline[i]) continue;
      let touches = false;
      grid.each4(i, j => { if (outline[j]) touches = true; });
      if (touches) inner.push(i);
    }
    for (const i of inner) { raster.px[i] = BLACK; outline[i] = true; }
  }
  removeStrayInk(raster, mask, outline, settings.width);
  LineCleanup.apply(raster, mask, outline, settings.width);
  if (lines) LineGuide.apply(raster, mask, outline, settings.width, lines);
  FaceDetail.apply(raster, mask);
  const boundary = new Array(grid.count).fill(false);
  if (settings.boundary && settings.transparency < 100) {
    const rim = [];
    for (let i = 0; i < grid.count; i++) {
      if (!mask[i] || outline[i] || !paper(raster.px[i])) continue;
      let touches = false;
      grid.each4(i, j => { if (outline[j]) touches = true; });
      if (touches) rim.push(i);
    }
    const counts = new Map();
    for (const i of rim) countVotes(counts, KEY(raster.px[i]), raster.px[i]);
    const best = firstMax(counts.values(), (a, b) => a[0] < b[0]);
    if (best) {
      const middle = mixed(best[1], BLACK, 50);
      const tint = mixed(best[1], middle, 100 - settings.transparency);
      for (const i of rim) { raster.px[i] = tint; boundary[i] = true; }
    }
  }
  return { image: raster, mask, outline, boundary, bodyCount: 0, headCount: 0 };
}

function removeStrayInk(raster, mask, outline, width) {
  const grid = raster.grid, depth = grid.depths(mask);
  const ink = i => { const p = raster.px[i]; return mask[i] && !outline[i] && light(p) < 70 && chroma(p) < 60; };
  const seen = new Uint8Array(grid.count), stray = [];
  for (let start = 0; start < grid.count; start++) {
    if (!(ink(start) && !seen[start] && depth[start] <= width + 2)) continue;
    const piece = [start];
    seen[start] = 1;
    for (let next = 0; next < piece.length; next++) grid.each8(piece[next], j => { if (ink(j) && !seen[j]) { seen[j] = 1; piece.push(j); } });
    if (piece.every(i => depth[i] <= width + 3)) stray.push(...piece);
  }
  stray.sort((a, b) => depth[a] - depth[b]);
  for (const i of stray) {
    const counts = new Map();
    grid.each8(i, j => { const p = raster.px[j]; if (mask[j] && !outline[j] && light(p) >= 70) countVotes(counts, KEY(p), p); });
    const best = firstMax(counts.values(), (a, b) => a[0] < b[0]);
    if (best) raster.px[i] = best[1];
  }
}

// ───────────────────────────── 원본 색 살림 (개선판 '약하게 · 원본 색 살림')
// 배경 정리 → 칸마다 대표 색 → 색 수만큼 팔레트 → 원본 대조 보정. 외곽선을 따로 씌우지 않아 원본 선을 그대로 살린다.
export function renderSoft(subject, w, h, settings) {
  const size = { w, h };
  const prepared = withoutLightBackground(subject.image());
  const fitted = fit(prepared.w, prepared.h, w, h);
  const side = 4, sw = fitted.w * side, sh = fitted.h * side;
  const bytes = rasterize(prepared, sw, sh, { x: 0, y: 0, w: sw, h: sh });
  const pixels = choosePixels(bytes, sw * 4, fitted.w, fitted.h);
  const palette = buildPalette(pixels, Math.max(2, Math.min(64, settings.softColors)));
  const encoded = palette.map(encodeSRGB);
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < fitted.h; y++) for (let x = 0; x < fitted.w; x++) {
    const pixel = pixels[y * fitted.w + x];
    const alpha = roundAway(F(pixel.alpha * 255));
    if (!(alpha > 0) || palette.length === 0) continue;
    const rgb = encoded[nearestLab(pixel.color, palette)];
    const o = ((y + fitted.top) * w + x + fitted.x) * 4;
    out[o] = Math.floor((rgb[0] * alpha + 127) / 255);
    out[o + 1] = Math.floor((rgb[1] * alpha + 127) / 255);
    out[o + 2] = Math.floor((rgb[2] * alpha + 127) / 255);
    out[o + 3] = alpha;
  }
  const checked = sourceCheck({ w, h, data: out }, prepared, size, [0, 0]);
  const image = Raster.fromPremultiplied(checked.data, w, h);
  if (settings.softLines) refineLines(image, prepared);
  if (settings.softVivid) vivid(image, 1.25);
  const result = settings.softClean ? flattenColors(Raster.fromPremultiplied(flatOutline(image.image()).data, w, h)) : image;
  const mask = Array.from(result.px, p => A(p) > 0);
  return { image: result, mask, outline: mask.map(() => false), boundary: mask.map(() => false), bodyCount: 0, headCount: 0 };
}

/**
 * 색 면 정리(원본 색 살림): 거의 같은 색(OKLab 거리 0.035 미만)을 더 많이 쓰인 색으로 합치고,
 * 같은 색 이웃이 하나도 없는 점은 둘레 다수 색(8칸 중 5칸 이상)으로 메운다. 선(진한 색)끼리는 합치지 않는다.
 */
function flattenColors(image, threshold = 0.035) {
  const px = image.px, isInk = LineCleanup.isInk;
  const counts = new Map();
  for (const p of px) if (A(p) > 0) counts.set(KEY(p), (counts.get(KEY(p)) ?? 0) + 1);
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => ((k << 8) | 255) >>> 0);
  const reps = [], map = new Map();
  for (const p of sorted) {
    if (isInk(p)) { map.set(KEY(p), p); continue; }
    const c = decodeLab(R(p), G(p), B(p), 255);
    const rep = reps.find(r => Math.hypot(r.c[0] - c[0], r.c[1] - c[1], r.c[2] - c[2]) < threshold);
    if (rep) map.set(KEY(p), rep.p); else { reps.push({ p, c }); map.set(KEY(p), p); }
  }
  for (let i = 0; i < px.length; i++) if (A(px[i]) > 0) px[i] = withAlpha(map.get(KEY(px[i])), A(px[i]));
  const grid = image.grid, before = px.slice();
  for (let i = 0; i < px.length; i++) {
    if (A(before[i]) === 0 || grid.edge(i)) continue;
    let same = 0, opaque = true;
    const votes = new Map();
    grid.each8(i, j => {
      if (A(before[j]) === 0) opaque = false;
      if (KEY(before[j]) === KEY(before[i])) same++;
      else votes.set(KEY(before[j]), (votes.get(KEY(before[j])) ?? 0) + 1);
    });
    if (!opaque || same > 0) continue;
    const [k, n] = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
    if (n >= 5) px[i] = withAlpha(keyPixel(k), A(before[i]));
  }
  return image;
}

/**
 * 선 1픽셀 정리(원본 색 살림): 큰 원본에서 선의 가운데 줄기(뼈대)를 먼저 찾고, 그 줄기가 지나는 칸만 선으로 칠한다.
 * 작게 줄인 뒤 깎는 것보다 입(ω) 같은 작은 굴곡이 살아 있고, 선이 끊기거나 뭉치지 않는다. 새 색은 만들지 않는다.
 */
export function refineLines(image, prepared) {
  const grid = image.grid, w = grid.w, h = grid.h, px = image.px;
  // 칸 하나를 6×6으로 나눠 뼈대를 찾는다. 큰 출력은 계산이 너무 커지지 않게 줄인다(한 변 약 1500픽셀까지).
  const f = fit(prepared.w, prepared.h, w, h);
  const side = Math.max(2, Math.min(6, Math.round(1500 / Math.max(f.w, f.h)))), bw = f.w * side, bh = f.h * side;
  const bytes = rasterize(prepared, bw, bh, { x: 0, y: 0, w: bw, h: bh });
  const darkPx = new Array(bw * bh).fill(false);
  const dark = new Float32Array(grid.count);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const k = y * bw + x, o = k * 4, a = bytes[o + 3];
    if (a <= 127 || !isDarkLab(decodeLab(bytes[o], bytes[o + 1], bytes[o + 2], a))) continue;
    darkPx[k] = true;
    dark[(((y / side) | 0) + f.top) * w + ((x / side) | 0) + f.x] += 1 / (side * side);
  }
  // 원본 해상도에서 선 뼈대
  zhangSuen(darkPx, new Grid(bw, bh), null);
  const mask = Array.from(px, p => A(p) > 0), isInk = LineCleanup.isInk;
  const line = new Array(grid.count).fill(false);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    if (darkPx[y * bw + x]) line[(((y / side) | 0) + f.top) * w + ((x / side) | 0) + f.x] = true;
  }
  // 넓게 어두운 면은 원래대로 둔다(자신과 이웃 대부분이 진함).
  const solid = mask.map((m, i) => {
    if (!m || dark[i] < 0.6) return false;
    let n = 0;
    grid.each8(i, j => { if (dark[j] >= 0.6) n++; });
    return n >= 6;
  });
  // 바깥 테두리 선은 원래대로 둔다(뼈대가 한 칸 안쪽에 잡히면 실루엣 선이 끊긴다).
  const outside = touchesOutside(mask, w, h);
  for (let i = 0; i < grid.count; i++) {
    if (!mask[i]) line[i] = false;
    else if (solid[i] || (outside[i] && isInk(px[i]))) line[i] = true;
  }
  // 계단 모서리(ㄴ자) 칸을 덜어 1픽셀 선으로. 실루엣 바깥 테두리는 그대로.
  const cut = corners(line, outside.map((o, i) => o || solid[i]), w, h);
  for (let i = 0; i < grid.count; i++) if (cut[i]) line[i] = false;

  const inks = new Map();
  for (let i = 0; i < grid.count; i++) if (mask[i] && isInk(px[i])) countVotes(inks, KEY(px[i]), px[i]);
  const inkColor = firstMax(inks.values(), (a, b) => a[0] < b[0])?.[1] ?? BLACK;
  const stale = [];
  for (let i = 0; i < grid.count; i++) {
    // 선 칸은 불투명하게(반투명 가장자리 칸에 잡힌 선이 흐려 보이지 않게)
    if (line[i] && (!isInk(px[i]) || A(px[i]) < 255)) px[i] = withAlpha(isInk(px[i]) ? px[i] : inkColor, 255);
    else if (!line[i] && mask[i] && isInk(px[i])) stale.push(i);
  }
  // 선이 아니게 된 칸은 선이 아닌 이웃 중 가장 흔한 색으로 메운다(이웃이 모두 선이면 다음 차례에).
  for (let round = 0; round < 3 && stale.length; round++) {
    for (let k = stale.length - 1; k >= 0; k--) {
      const i = stale[k];
      const fill = commonNeighbor(image, i, mask, j => line[j] || isInk(px[j]));
      if (fill !== undefined) { px[i] = withAlpha(fill, A(px[i])); stale.splice(k, 1); }
    }
  }
  return image;
}

/** 선명하게: OKLab 채도를 factor배로. 흰색·검정·회색(채도 0.02 미만)은 그대로, 알파도 그대로. */
export function vivid(image, factor) {
  const cache = new Map();
  for (let i = 0; i < image.px.length; i++) {
    const p = image.px[i];
    if (A(p) === 0) continue;
    let rgb = cache.get(KEY(p));
    if (rgb === undefined) {
      const [L, a, b] = decodeLab(R(p), G(p), B(p), 255);
      rgb = Math.hypot(a, b) < 0.02 ? null : oklabToRGB(L, a * factor, b * factor);
      cache.set(KEY(p), rgb);
    }
    if (rgb) image.px[i] = pack(rgb[0], rgb[1], rgb[2], A(p));
  }
  return image;
}

/** OKLab → sRGB 바이트(배정밀도, 범위 밖은 자름) */
function oklabToRGB(L, a, b) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  const linear = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
  return linear.map(v => {
    v = Math.min(1, Math.max(0, v));
    return Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));
  });
}

// ───────────────────────────── 앱이 쓰는 입구
/** 원본(프리멀티플라이 이미지) → 캐릭터 → 축소 */
export function prepare(original, w, h, masked = null, faithful = false) {
  const subject = Subject.extract(original, masked, faithful);
  return { subject, reduced: faithful ? reduceDirect(subject, w, h) : reduce(subject, w, h) };
}
export function render(subject, reduced, settings, lines = null) {
  if (settings.method === 'faithful') return renderFaithful(reduced, settings, subject);
  const guide = settings.aiLines ? lines : null;
  const w = reduced.image.grid.w, h = reduced.image.grid.h;
  if (settings.method === 'soft') return renderSoft(subject, w, h, settings);
  // 2.0 방식과 원본 직행은 같은 그리기에 축소만 다르다(원본 직행은 원본에서 바로 격자를 읽음).
  return settings.method === 'basic' || settings.method === 'direct' ? renderBasic(reduced, settings, guide) : renderBerry(subject, w, h, settings, guide);
}
export function dotStatus(settings, dotted) {
  if (settings.method === 'faithful') {
    const extras = [settings.snapColors && '원본 색 맞추기', settings.cleanBlends && '경계 섞인 색 정리', settings.preserveMouth && '작은 입선 보존', settings.crispOutline && '바깥 외곽선 원본 선 색'].filter(Boolean);
    return `원본 보존  ·  ${dotted.image.grid.w}×${dotted.image.grid.h} px  ·  투명 PNG${extras.length ? '  ·  ' + extras.join(' · ') : ''}`;
  }
  const colors = `실제 ${ColorReducer.count(dotted.image)}색`;
  if (settings.method === 'soft') {
    // 가장자리 반투명 칸은 같은 색도 알파에 따라 값이 조금씩 달라 따로 세지 않는다(불투명 칸의 색 수).
    const opaque = new Set();
    for (const p of dotted.image.px) if (A(p) === 255) opaque.add(KEY(p));
    return `원본 색 살림${settings.softLines ? ' · 선 1px 정리' : ''}${settings.softVivid ? ' · 선명하게' : ''}${settings.softClean ? ' · 테두리·색 면 정리' : ''}  ·  ${opaque.size}색 (가장자리 반투명 제외)`;
  }
  if (settings.method !== 'basic') return `${settings.method === 'direct' ? '원본 직행' : '베리 잉크'}  ·  ${colors}`;
  const head = dotted.headCount > 0 ? '분홍 머리 영역 감지' : '분홍 머리 영역 미감지';
  const body = dotted.bodyCount > 0 ? '밝은 몸통 영역 감지' : '밝은 몸통 영역 미감지';
  return `${head}  ·  ${body}  ·  ${colors}`;
}

// ───────────────────────────── 원본 보존 (맥 시험판 DotMaker 100-100에서 옮김)
// 원본 픽셀이 최종 격자 한 칸에 걸치는 넓이만큼 그대로 평균 낸다(중간 축소 없음).

/** 원본 칸이 목표 칸에 걸치는 길이. 단위는 목표 칸 하나 = source. */
function overlaps(source, target) {
  return Array.from({ length: target }, (_, cell) => {
    const start = cell * source, end = (cell + 1) * source, list = [];
    for (let pixel = Math.floor(start / target); pixel <= Math.floor((end - 1) / target); pixel++) {
      list.push([pixel, Math.min(end, (pixel + 1) * target) - Math.max(start, pixel * target)]);
    }
    return list;
  });
}

export function reduceDirect(subject, w, h) {
  if (!(w >= 16 && w <= 512 && h >= 16 && h <= 512)) fail('dimensions');
  const scale = Math.min((w - 4) / subject.grid.w, (h - 4) / subject.grid.h);
  const sw = Math.max(1, Math.round(subject.grid.w * scale));
  const sh = Math.max(1, Math.round(subject.grid.h * scale));
  const x = Math.trunc((w - sw) / 2), y = Math.trunc((h - sh) / 2);
  const columns = overlaps(subject.grid.w, sw), rows = overlaps(subject.grid.h, sh);
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
 * 가장 바깥 실루엣을 1픽셀 선으로 또렷하게 긋고 그 바깥의 흐린 칸을 지운다.
 * cells가 있으면 원본 그 자리에 선이 있는 칸만 원본 선 색으로(없는 칸은 제 색 그대로), 없으면 전부 검정.
 * 바깥 테두리가 대부분 밝은 조각(일부러 그린 흰 외곽선)은 제 색을 둔다.
 */
export function crispOutline(input, cells = null) {
  const grid = input.grid, px = input.px, output = new Raster(grid.w, grid.h);
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
      output.px[i] = withAlpha(line ?? px[i], 255);
    }
  }
  return output;
}

export function renderFaithful(reduced, settings, subject) {
  let image = reduced.image;
  if (settings.snapColors) image = snapColors(image, reduced, subject);
  if (settings.cleanBlends) image = cleanBlends(image);
  if (settings.preserveMouth) { image = image.clone(); FaceDetail.preserveMouth(image, reduced); }
  if (settings.crispOutline) image = crispOutline(image, reduced.cells);
  return { image };
}
