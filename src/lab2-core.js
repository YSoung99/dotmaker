// 색면을 먼저 단순화한 뒤 줄인다. 알파로 가중한 Kuwahara 필터의 네 구역 중
// 색 변화가 가장 적은 구역을 고르므로 면 안의 얼룩이 줄고 경계는 유지된다.
function lab2Flatten(source, radius, region) {
  const { w, h, bytes } = source;
  const stride = (w + 1) * 5;
  const sums = new Uint32Array(stride * (h + 1));
  for (let y = 1; y <= h; y++) for (let x = 1; x <= w; x++) {
    const i = ((y - 1) * w + x - 1) * 4, j = y * stride + x * 5;
    const r = bytes[i], g = bytes[i + 1], b = bytes[i + 2], a = bytes[i + 3];
    const add = (k, value) => { sums[j + k] = value + sums[j + k - 5] + sums[j + k - stride] - sums[j + k - stride - 5]; };
    add(0, r * a); add(1, g * a); add(2, b * a); add(3, a);
    add(4, Math.round((r * r + g * g + b * b) * a / 255));
  }
  const box = (k, tl, tr, bl, br) => (sums[br + k] - sums[tr + k] - sums[bl + k] + sums[tl + k]) >>> 0;
  const out = bytes.slice();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x, i = p * 4;
    if (!bytes[i + 3] || (region && !region[p])) continue;
    let best = Infinity;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const left = dx ? x : Math.max(0, x - radius), right = dx ? Math.min(w, x + radius + 1) : x + 1;
      const top = dy ? y : Math.max(0, y - radius), bottom = dy ? Math.min(h, y + radius + 1) : y + 1;
      const tl = top * stride + left * 5, tr = top * stride + right * 5;
      const bl = bottom * stride + left * 5, br = bottom * stride + right * 5;
      const alpha = box(3, tl, tr, bl, br);
      if (alpha < (right - left) * (bottom - top) * bytes[i + 3] * 0.5) continue;
      const r = box(0, tl, tr, bl, br) / alpha, g = box(1, tl, tr, bl, br) / alpha, b = box(2, tl, tr, bl, br) / alpha;
      const variance = box(4, tl, tr, bl, br) * 255 / alpha - (r * r + g * g + b * b);
      // 비슷하게 평평한 색면끼리는 원본 색에 가까운 쪽을 고른다.
      const score = Math.max(0, variance) + 0.06 * ((r - bytes[i]) ** 2 + (g - bytes[i + 1]) ** 2 + (b - bytes[i + 2]) ** 2);
      if (score >= best) continue;
      best = score;
      out[i] = Math.round(r); out[i + 1] = Math.round(g); out[i + 2] = Math.round(b);
    }
  }
  return { w, h, bytes: out };
}

function lab2Region({ w, h }, rectangles) {
  const mask = new Uint8Array(w * h);
  for (const [x0, y0, x1, y1] of rectangles) {
    for (let y = y0; y < y1; y++) mask.fill(1, y * w + x0, y * w + x1);
  }
  return mask;
}

function lab2Coverage(source, small, mask) {
  const coverage = new Uint8Array(small.w * small.h);
  for (let y = 0; y < small.h; y++) for (let x = 0; x < small.w; x++) {
    const x0 = Math.floor(x * source.w / small.w), x1 = Math.max(x0 + 1, Math.floor((x + 1) * source.w / small.w));
    const y0 = Math.floor(y * source.h / small.h), y1 = Math.max(y0 + 1, Math.floor((y + 1) * source.h / small.h));
    for (let v = y0; v < y1; v++) for (let u = x0; u < x1; u++) {
      const i = v * source.w + u;
      if (mask[i] && source.bytes[i * 4 + 3]) coverage[y * small.w + x] = 1;
    }
  }
  return coverage;
}

function lab2Compute(source, { size, colors, mode, region, radius, local }) {
  const scale = Math.max(source.w, source.h) / size;
  const filtered = mode === 'flatten' ? lab2Flatten(source, radius, region) : source;
  const result = labVote(filtered, scale, true, mode === 'protect' ? region : null, true);
  const coverage = region && (local || mode === 'protect') && lab2Coverage(source, result, region);
  let palette;
  if (local && coverage) {
    // 선택 밖은 기본 도트화와 같은 칸과 팔레트를 사용한다.
    const base = labVote(source, scale, true, null, true);
    palette = labAutoPalette(base, colors);
    for (let p = 0; p < coverage.length; p++) {
      if (!coverage[p]) result.bytes.set(base.bytes.subarray(p * 4, p * 4 + 4), p * 4);
    }
  } else {
    palette = labAutoPalette(result, colors, coverage);
  }
  return { picture: { w: result.w, h: result.h, bytes: result.bytes }, colors: labQuantize(result, palette) };
}
