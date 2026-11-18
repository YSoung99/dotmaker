// 메이플 램프(실험 탭 방식): 재질 → 재질별 음영 램프 → 색 있는 윤곽선. 게임 스킨처럼 명암과 색을 살린 도트를 만든다.
// 옛 맥 앱 DotMaker/Legacy/MapleRamp.swift(YSoung99/dotmaker-mac)를 옮긴 것. 화면과 작업자가 함께 쓰고(SHARED), 계산은 작업자가 한다.
// 1. 칸마다 4×4 표본 중 가장 대표적인 실제 표본 색을 고른다(평균을 쓰지 않아 경계가 또렷하다).
// 2. 밝기는 약하게, 색 계열은 강하게 보고 k-평균으로 재질을 나눈다. 무채색은 밝기로 가른다.
// 3. 재질마다 밝기만 2~5단계로 나눠 램프를 만들고, 단계 색은 평균이 아닌 가장 흔한 실제 색으로 정한다.
// 4. 그림자는 보라·파랑 쪽, 밝은 쪽은 노랑 쪽으로 살짝 색상을 튼다(휴 시프트).
// 5. 가는 어두운 선과 바깥 테두리는 윤곽선으로 칠한다. 넓게 어두운 면(검은 옷 등)은 재질로 남겨 음영을 지킨다.
// 색 계산은 모두 OKLab([L, a, b])으로 한다.
// 맥판의 '원본 대조 선 다듬기'(refineLines·bridgeLines)·목표 스타일·재질 색 조정·선 안쪽 중간색은 옮기지 않았다.

const MAPLE_INK = [0x1d, 0x15, 0x14];   // 진한 잉크 윤곽선: 메이플식 아주 진한 고동색 한 가지
const MAPLE_SIDES = [[-1, 0], [1, 0], [0, -1], [0, 1]];

const mapleLinear = Array.from({ length: 256 }, (_, byte) => {
  const v = byte / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
});

/** sRGB 8비트 → OKLab */
function mapleDecode(r8, g8, b8) {
  const r = mapleLinear[r8], g = mapleLinear[g8], b = mapleLinear[b8];
  const l = Math.cbrt(0.41222147 * r + 0.53633255 * g + 0.05144599 * b);
  const m = Math.cbrt(0.21190350 * r + 0.68069955 * g + 0.10739696 * b);
  const s = Math.cbrt(0.08830246 * r + 0.28171884 * g + 0.62997870 * b);
  return [0.21045426 * l + 0.79361779 * m - 0.00407205 * s,
    1.97799850 * l - 2.42859221 * m + 0.45059371 * s,
    0.02590404 * l + 0.78277177 * m - 0.80867577 * s];
}

/** OKLab → sRGB 8비트 */
function mapleEncode([L, A, B]) {
  const l = (L + 0.39633778 * A + 0.21580376 * B) ** 3;
  const m = (L - 0.10556135 * A - 0.06385417 * B) ** 3;
  const s = (L - 0.08948418 * A - 1.29148555 * B) ** 3;
  const channel = linear => {
    const v = Math.min(1, Math.max(0, linear));
    return Math.round((v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055) * 255);
  };
  return [channel(4.07674166 * l - 3.30771159 * m + 0.23096993 * s),
    channel(-1.26843800 * l + 2.60975740 * m - 0.34131940 * s),
    channel(-0.00419609 * l - 0.70341861 * m + 1.70761470 * s)];
}

const mapleChroma = c => Math.hypot(c[1], c[2]);
const mapleDistance2 = (p, q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
const mapleRound = x => (x < 0 ? -Math.round(-x) : Math.round(x));   // Swift .rounded()와 같은 반올림(0에서 먼 쪽)

/** 같은 입력이면 늘 같은 결과가 나오게 씨앗을 고정한 난수(SplitMix64) */
function mapleRandom(seed) {
  const mask = (1n << 64n) - 1n;
  let state = (BigInt(seed) + 0x9E3779B97F4A7C15n) & mask;
  return () => {
    state = (state + 0x9E3779B97F4A7C15n) & mask;
    let z = state;
    z = ((z ^ (z >> 30n)) * 0xBF58476D1CE4E5B9n) & mask;
    z = ((z ^ (z >> 27n)) * 0x94D049BB133111EBn) & mask;
    return z ^ (z >> 31n);
  };
}

/** 표 중 가장 많은 것(같으면 번호가 작은 것). votes: Map(번호 → 표) */
function mapleMost(votes) {
  let best = null, most = -1;
  for (const [key, value] of votes) if (value > most || (value === most && key < best)) { best = key; most = value; }
  return best;
}

/** k-평균(시작점은 k-means++). 점마다 묶음 번호를 돌려준다. */
function mapleKmeans(points, k, random, iterations = 25) {
  if (k <= 1 || points.length <= 1) return new Array(points.length).fill(0);
  const centers = [points[Number(random() % BigInt(points.length))]];
  const nearest = points.map(p => mapleDistance2(p, centers[0]));
  while (centers.length < k) {
    const total = nearest.reduce((a, b) => a + b, 0);
    if (!(total > 0)) break;
    let target = (Number(random() % 1000000n) / 1000000) * total, chosen = points.length - 1;
    for (let n = 0; n < nearest.length; n++) {
      target -= nearest[n];
      if (target <= 0) { chosen = n; break; }
    }
    centers.push(points[chosen]);
    for (let n = 0; n < points.length; n++) nearest[n] = Math.min(nearest[n], mapleDistance2(points[n], points[chosen]));
  }
  const labels = new Array(points.length).fill(0);
  for (let round = 0; round < iterations; round++) {
    let changed = false;
    for (let n = 0; n < points.length; n++) {
      let best = 0, closest = Infinity;
      for (let c = 0; c < centers.length; c++) {
        const d = mapleDistance2(points[n], centers[c]);
        if (d < closest) { closest = d; best = c; }
      }
      if (labels[n] !== best) { labels[n] = best; changed = true; }
    }
    const sums = centers.map(() => [0, 0, 0]), counts = centers.map(() => 0);
    points.forEach((p, n) => { const s = sums[labels[n]]; s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; counts[labels[n]]++; });
    for (let c = 0; c < centers.length; c++) if (counts[c]) centers[c] = sums[c].map(v => v / counts[c]);
    if (!changed) break;
  }
  return labels;
}

/** 칸마다 대표 표본: 칸을 4×4로 나눠 각 조각을 원본에서 평균 낸 뒤, 채널별 중앙값에 가장 가까운 실제 표본. 덜 덮인 칸은 null. */
function mapleSample(source, w, h) {
  const side = 4, sw = w * side, sh = h * side, src = source.bytes;
  const span = (k, n, size) => { const a = Math.floor(k * size / n); return [a, Math.max(a + 1, Math.floor((k + 1) * size / n))]; };
  const xs = Array.from({ length: sw }, (_, k) => span(k, sw, source.w)), ys = Array.from({ length: sh }, (_, k) => span(k, sh, source.h));
  const middle = values => {
    const s = values.slice().sort((a, b) => a - b), n = s.length;
    return n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2;
  };
  const cells = new Array(w * h).fill(null);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const points = [];
    let coverage = 0;
    for (let sy = 0; sy < side; sy++) for (let sx = 0; sx < side; sx++) {
      const [x0, x1] = xs[x * side + sx], [y0, y1] = ys[y * side + sy];
      let r = 0, g = 0, b = 0, a = 0;
      for (let v = y0; v < y1; v++) for (let u = x0; u < x1; u++) {
        const i = (v * source.w + u) * 4, alpha = src[i + 3];
        r += src[i] * alpha; g += src[i + 1] * alpha; b += src[i + 2] * alpha; a += alpha;
      }
      const alpha = Math.round(a / ((x1 - x0) * (y1 - y0)));
      coverage += alpha;
      if (alpha > 127) points.push(mapleDecode(Math.round(r / a), Math.round(g / a), Math.round(b / a)));
    }
    if (coverage * 2 < 255 * side * side || points.length === 0) continue;
    const median = [0, 1, 2].map(k => middle(points.map(p => p[k])));
    cells[y * w + x] = points.reduce((best, p) => (mapleDistance2(p, median) < mapleDistance2(best, median) ? p : best));
  }
  return cells;
}

/** 주변 대부분이 다른 재질인 칸과 3칸보다 작은 조각을 주변 재질로 합친다. */
function mapleCleanMaterials(material, opaque, w, h) {
  const initial = material.slice();
  for (const i of opaque) {
    const x = i % w, y = (i / w) | 0, votes = new Map();
    for (let v = Math.max(0, y - 1); v <= Math.min(h - 1, y + 1); v++) for (let u = Math.max(0, x - 1); u <= Math.min(w - 1, x + 1); u++) {
      const m = initial[v * w + u];
      if ((u !== x || v !== y) && m >= 0) votes.set(m, (votes.get(m) ?? 0) + 1);
    }
    const best = mapleMost(votes);
    if (best !== null && votes.get(best) >= 6 && best !== initial[i]) material[i] = best;
  }
  const seen = new Uint8Array(material.length);
  for (const start of opaque) {
    if (seen[start]) continue;
    const label = material[start], component = [start];
    seen[start] = 1;
    for (let head = 0; head < component.length; head++) {
      const j = component[head], x = j % w, y = (j / w) | 0;
      for (const [dx, dy] of MAPLE_SIDES) {
        const u = x + dx, v = y + dy, n = v * w + u;
        if (u >= 0 && v >= 0 && u < w && v < h && !seen[n] && material[n] === label) { seen[n] = 1; component.push(n); }
      }
    }
    if (component.length >= 3) continue;
    const votes = new Map();
    for (const j of component) {
      const x = j % w, y = (j / w) | 0;
      for (const [dx, dy] of MAPLE_SIDES) {
        const u = x + dx, v = y + dy;
        if (u < 0 || v < 0 || u >= w || v >= h) continue;
        const m = material[v * w + u];
        if (m >= 0 && m !== label) votes.set(m, (votes.get(m) ?? 0) + 1);
      }
    }
    const best = mapleMost(votes);
    if (best !== null) for (const j of component) material[j] = best;
  }
}

/** 같은 재질 이웃 중 같은 단계가 allowed개 이하인 튀는 칸을 이웃 단계로 맞춘다. skip인 칸(가는 선)은 표를 던지지 않는다. */
function mapleSmoothTones(tone, material, cells, skip, w, h, allowed) {
  const initial = tone.slice();
  for (const i of cells) {
    const x = i % w, y = (i / w) | 0, votes = new Map();
    let same = 0;
    for (let v = Math.max(0, y - 1); v <= Math.min(h - 1, y + 1); v++) for (let u = Math.max(0, x - 1); u <= Math.min(w - 1, x + 1); u++) {
      const j = v * w + u;
      if ((u === x && v === y) || material[j] !== material[i] || skip[j]) continue;
      same++;
      votes.set(initial[j], (votes.get(initial[j]) ?? 0) + 1);
    }
    const best = mapleMost(votes);
    if (same >= 5 && (votes.get(initial[i]) ?? 0) <= allowed && best !== null) tone[i] = best;
  }
}

/** 평균 대신 가장 흔한 실제 색(평균은 채도를 떨어뜨려 탁해진다). 개수가 같으면 칸 번호가 작은 쪽. */
function mapleCommonest(points) {
  const bins = new Map();
  for (const p of points) {
    const key = [mapleRound(p[0] / 0.03), mapleRound(p[1] / 0.02), mapleRound(p[2] / 0.02)];
    const id = key.join(',');
    const bin = bins.get(id) ?? { key, total: [0, 0, 0], count: 0 };
    bin.total[0] += p[0]; bin.total[1] += p[1]; bin.total[2] += p[2]; bin.count++;
    bins.set(id, bin);
  }
  const smaller = (a, b) => a[0] !== b[0] ? a[0] < b[0] : a[1] !== b[1] ? a[1] < b[1] : a[2] < b[2];
  let best = null;
  for (const bin of bins.values()) if (!best || bin.count > best.count || (bin.count === best.count && smaller(bin.key, best.key))) best = bin;
  return best.total.map(v => v / best.count);
}

/** 크게 다른 재질 두 덩어리가 맞닿는 곳에서, 더 어두운 쪽 칸에 선을 긋는다(갇힌 작은 덩어리·아주 작은 조각은 빼고). */
function mapleBoundaries(isOutline, material, ramps, opaque, w, h) {
  const size = new Int32Array(material.length), seen = new Uint8Array(material.length);
  for (const start of opaque) {
    if (seen[start]) continue;
    const component = [start];
    let open = false;
    seen[start] = 1;
    for (let head = 0; head < component.length; head++) {
      const j = component[head], x = j % w, y = (j / w) | 0;
      for (const [dx, dy] of MAPLE_SIDES) {
        const u = x + dx, v = y + dy;
        if (u < 0 || v < 0 || u >= w || v >= h) { open = true; continue; }
        const n = v * w + u;
        if (material[n] < 0) { open = true; continue; }
        if (!seen[n] && material[n] === material[start]) { seen[n] = 1; component.push(n); }
      }
    }
    const value = open || component.length >= 80 ? component.length : 0;
    for (const j of component) size[j] = value;
  }
  const bases = ramps.map(ramp => [0, 1, 2].map(k => ramp.reduce((sum, c) => sum + c[k], 0) / ramp.length));
  const initial = isOutline.slice();
  for (const i of opaque) {
    if (initial[i] || size[i] < 16) continue;
    const x = i % w, y = (i / w) | 0;
    for (const [dx, dy] of MAPLE_SIDES) {
      const u = x + dx, v = y + dy;
      if (u < 0 || v < 0 || u >= w || v >= h) continue;
      const n = v * w + u, a = material[i], b = material[n];
      if (b < 0 || b === a || initial[n] || size[n] < 16) continue;
      const p = bases[a], q = bases[b];
      if (Math.sqrt(mapleDistance2(p, q)) > 0.12 && (p[0] < q[0] || (p[0] === q[0] && i < n))) { isOutline[i] = true; break; }
    }
  }
}

/** 외톨이 음영 점: 같은 재질·같은 음영 이웃(8방향)이 하나도 없는 칠 칸은, 같은 재질 이웃 중 가장 많은 음영으로 맞춘다. 맞춘 칸 수. */
function mapleDropSpecks(material, tone, w, h) {
  const snapshot = tone.slice();
  let fixed = 0;
  for (let i = 0; i < w * h; i++) {
    if (material[i] < 0 || snapshot[i] < 0) continue;
    const x = i % w, y = (i / w) | 0, m = material[i], votes = new Map();
    let alone = true;
    for (let v = Math.max(0, y - 1); v <= Math.min(h - 1, y + 1); v++) for (let u = Math.max(0, x - 1); u <= Math.min(w - 1, x + 1); u++) {
      const j = v * w + u;
      if ((u === x && v === y) || material[j] !== m || snapshot[j] < 0) continue;
      if (snapshot[j] === snapshot[i]) alone = false;
      votes.set(snapshot[j], (votes.get(snapshot[j]) ?? 0) + 1);
    }
    const best = mapleMost(votes);
    if (alone && best !== null) { tone[i] = best; fixed++; }
  }
  return fixed;
}

/**
 * 메이플 램프로 w×h칸 도트를 만든다. source: { w, h, bytes }(곧은 RGBA)
 * options: { materials: 재질 수, tones: 음영 단계(2~5), outline: 'ink' | 'material' | 'none', hueShift, boundary }
 * 돌려주는 것: { bytes, materials: 실제 재질 수, specks: 정리한 외톨이 음영 점 수 }
 */
function mapleBuild(source, w, h, options) {
  const count = w * h, colors = mapleSample(source, w, h);
  const opaque = [];
  for (let i = 0; i < count; i++) if (colors[i]) opaque.push(i);
  const bytes = new Uint8ClampedArray(count * 4);
  if (!opaque.length) return { bytes, materials: 0, specks: 0 };

  // 재질 나누기: 색 계열(a, b)을 강하게, 밝기는 무채색일 때만 강하게 본다.
  const features = opaque.map(i => { const c = colors[i]; return [c[1] * 3, c[2] * 3, c[0] * (mapleChroma(c) < 0.035 ? 1.6 : 0.45)]; });
  const assignment = mapleKmeans(features, Math.min(options.materials, opaque.length), mapleRandom(0));
  const material = new Array(count).fill(-1);
  opaque.forEach((i, n) => { material[i] = assignment[n]; });
  mapleCleanMaterials(material, opaque, w, h);
  // 쓰인 재질만 많이 쓰인 순서로 다시 번호를 매긴다.
  const usage = new Map();
  for (const i of opaque) usage.set(material[i], (usage.get(material[i]) ?? 0) + 1);
  const order = [...usage.keys()].sort((a, b) => usage.get(b) - usage.get(a) || a - b);
  const remap = new Map(order.map((m, k) => [m, k]));
  for (const i of opaque) material[i] = remap.get(material[i]);
  const materialCount = order.length;

  // 어두운 칸과, 그중 넓은 면(검은 옷 등)이 아닌 가는 선 칸. 가는 선은 윤곽선이 될 거라 음영 램프에서 뺀다
  // (넣으면 모든 재질의 가장 어두운 단계가 검정이 돼 금장식·흰 옷 안에 검은 잔점이 찍힌다).
  const dark = Array.from({ length: count }, (_, i) => material[i] >= 0 && colors[i][0] < 0.42 && mapleChroma(colors[i]) < 0.06);
  const surface = i => {
    const x = i % w, y = (i / w) | 0;
    let darkCount = 0, cells = 0;
    for (let v = Math.max(0, y - 2); v <= Math.min(h - 1, y + 2); v++) for (let u = Math.max(0, x - 2); u <= Math.min(w - 1, x + 2); u++) {
      cells++;
      if (dark[v * w + u]) darkCount++;
    }
    return darkCount / cells > 0.45;
  };
  const lineCell = Array.from({ length: count }, (_, i) => options.outline !== 'none' && dark[i] && !surface(i));

  // 재질마다 음영 단계(0이 가장 어두움): 밝기만 보고 나눈다.
  const tone = new Array(count).fill(0);
  const members = Array.from({ length: materialCount }, () => []);
  for (const i of opaque) members[material[i]].push(i);
  for (let m = 0; m < materialCount; m++) {
    const body = members[m].filter(i => !lineCell[i]);
    if (body.length) members[m] = body;
    const lights = members[m].map(i => colors[i][0]);
    const range = lights.reduce((a, b) => Math.max(a, b), -Infinity) - lights.reduce((a, b) => Math.min(a, b), Infinity);
    const levels = Math.max(1, Math.min(options.tones, mapleRound(range / 0.07), lights.length));
    const raw = mapleKmeans(lights.map(l => [l, 0, 0]), levels, mapleRandom(m + 1));
    const sums = new Array(levels).fill(0), ns = new Array(levels).fill(0);
    raw.forEach((label, n) => { sums[label] += lights[n]; ns[label]++; });
    const mean = k => (ns[k] ? sums[k] / ns[k] : 9);
    const sorted = [...Array(levels).keys()].sort((a, b) => mean(a) - mean(b) || a - b);
    const rank = new Array(levels);
    sorted.forEach((label, r) => { rank[label] = r; });
    members[m].forEach((i, n) => { tone[i] = rank[raw[n]]; });
  }
  // 진한 잉크 스타일은 음영 띠를 더 깔끔하게(2번, 조금 더 과감하게) 정리한다.
  const ink = options.outline === 'ink', bodyCells = opaque.filter(i => !lineCell[i]);
  for (let pass = 0; pass < (ink ? 2 : 1); pass++) mapleSmoothTones(tone, material, bodyCells, lineCell, w, h, ink ? 1 : 0);

  // 램프와 윤곽선 색
  const ramps = [], outlines = [];
  for (let m = 0; m < materialCount; m++) {
    const all = members[m].map(i => colors[i]);
    const base = [0, 1, 2].map(k => all.reduce((sum, c) => sum + c[k], 0) / all.length);
    const baseHue = Math.atan2(base[2], base[1]), baseChroma = mapleChroma(base);
    const levels = members[m].reduce((most, i) => Math.max(most, tone[i]), 0) + 1;
    const ramp = [];
    for (let level = 0; level < levels; level++) {
      const points = members[m].filter(i => tone[i] === level).map(i => colors[i]);
      let c = points.length ? mapleCommonest(points) : (ramp[ramp.length - 1] ?? base);
      // 휴 시프트: 어두울수록 색상을 돌리고 채도를 올린다.
      if (options.hueShift && baseChroma > 0.03) {
        const depth = c[0] - base[0], hue = Math.atan2(c[2], c[1]) - 0.9 * depth;
        const chroma = mapleChroma(c) * (1 + Math.max(0, -depth) * 1.2);
        c = [c[0], chroma * Math.cos(hue), chroma * Math.sin(hue)];
      }
      ramp.push(c);
    }
    const darkest = ramp[0];
    if (baseChroma >= 0.03) {
      const chroma = Math.max(mapleChroma(darkest) * 1.4, 0.045);
      outlines.push([Math.min(0.42, Math.max(0.22, darkest[0] * 0.55)), chroma * Math.cos(baseHue), chroma * Math.sin(baseHue)]);
    } else {
      outlines.push([Math.min(0.36, Math.max(0.18, darkest[0] * 0.5)), 0.02, -0.035]);   // 무채색: 자두빛이 도는 회색 윤곽선
    }
    ramps.push(ramp);
  }

  // 윤곽선: 가는 선 칸은 맞닿은 밝은 재질의 선 색, 바깥 테두리는 그 재질의 선 색
  if (options.outline !== 'none') {
    const outlineMaterial = material.slice(), isOutline = new Array(count).fill(false);
    for (const i of opaque) {
      const x = i % w, y = (i / w) | 0;
      if (dark[i]) {
        if (!lineCell[i]) continue;
        const votes = new Map();
        for (let v = Math.max(0, y - 1); v <= Math.min(h - 1, y + 1); v++) for (let u = Math.max(0, x - 1); u <= Math.min(w - 1, x + 1); u++) {
          const j = v * w + u;
          if ((u !== x || v !== y) && material[j] >= 0 && !dark[j]) votes.set(material[j], (votes.get(material[j]) ?? 0) + 1);
        }
        const best = mapleMost(votes);
        if (best !== null) { isOutline[i] = true; outlineMaterial[i] = best; }
      } else if (MAPLE_SIDES.some(([dx, dy]) => {
        const u = x + dx, v = y + dy;
        return u < 0 || v < 0 || u >= w || v >= h || material[v * w + u] < 0;
      })) isOutline[i] = true;
    }
    if (options.boundary) mapleBoundaries(isOutline, material, ramps, opaque, w, h);
    for (const i of opaque) if (isOutline[i]) { material[i] = outlineMaterial[i]; tone[i] = -1; }
  }
  const specks = mapleDropSpecks(material, tone, w, h);

  // 칠하기: 재질×단계 색표(0번은 윤곽선)
  const inkLab = mapleDecode(...MAPLE_INK);
  const table = ramps.map((ramp, m) => [mapleEncode(ink ? inkLab : outlines[m]), ...ramp.map(mapleEncode)]);
  for (let i = 0; i < count; i++) {
    if (material[i] < 0) continue;
    const rgb = table[material[i]][tone[i] + 1];
    bytes[i * 4] = rgb[0]; bytes[i * 4 + 1] = rgb[1]; bytes[i * 4 + 2] = rgb[2]; bytes[i * 4 + 3] = 255;
  }
  return { bytes, materials: materialCount, specks };
}
