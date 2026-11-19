// 실험 탭(베타)의 순수 계산. 화면과 작업자가 함께 쓰고(SHARED), 실제 계산은 작업자가 한다.
// 그림은 { w, h, bytes }(곧은 RGBA)이고, 화면·DOM·저장소는 쓰지 않는다.
const LAB_MAX_SIDE = 512;
// 투표 방식: 칸이 어느 색 영역인지 정할 때만 쓰는 색 수, 그리고 '작은 디테일'로 볼 기준
const LAB_VOTE_COLORS = 32;
const LAB_DETAIL = { contrast: 56, share: 0.15 };   // 둘레 색과의 밝기 차(0~255), 칸에서 차지하는 최소 넓이 비율
const LAB_OUTLINE_DARK = 90;                        // 이보다 어두운 가장자리 칸을 외곽선으로 본다(밝기 0~255)

/** 원본을 wanted×wanted 픽셀씩 평균 내 한 칸으로 줄인다. 절반 넘게 투명한 칸은 투명. */
function labShrink(source, wanted) {
  const scale = Math.max(wanted, Math.max(source.w, source.h) / LAB_MAX_SIDE);
  const w = Math.max(1, Math.round(source.w / scale)), h = Math.max(1, Math.round(source.h / scale));
  const out = new Uint8ClampedArray(w * h * 4), src = source.bytes;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * source.h / h), y1 = Math.max(y0 + 1, Math.floor((y + 1) * source.h / h));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * source.w / w), x1 = Math.max(x0 + 1, Math.floor((x + 1) * source.w / w));
      let r = 0, g = 0, b = 0, a = 0;
      for (let v = y0; v < y1; v++) for (let u = x0; u < x1; u++) {
        const i = (v * source.w + u) * 4, alpha = src[i + 3];
        r += src[i] * alpha; g += src[i + 1] * alpha; b += src[i + 2] * alpha; a += alpha;
      }
      const o = (y * w + x) * 4, area = (y1 - y0) * (x1 - x0);
      if (a < area * 128) continue;
      out[o] = Math.round(r / a); out[o + 1] = Math.round(g / a); out[o + 2] = Math.round(b / a); out[o + 3] = 255;
    }
  }
  return { w, h, bytes: out, scale };
}

/**
 * 투표 방식(두 단계): 칸의 '모양'과 '색'을 따로 정한다.
 * 1) 그림을 몇십 색으로 단순화한 라벨로, 칸마다 어느 색 영역이 이기는지 투표한다(가운데에 가까울수록 표가 큼).
 *    섞인 중간색이 아니라 또렷한 라벨끼리 겨루므로 영역 경계가 탁해지지 않는다.
 * 2) 칸 색은 이긴 라벨을 가진 원본 픽셀만 평균 낸다. 단순화한 색이 아니라 원본의 실제 색이 나온다.
 * protect: 칸보다 가는 선·작은 하이라이트는 투표에서 지므로, 둘레와 밝기가 뚜렷이 다르고
 *          옆 칸보다 그 색이 많이 지나가는(줄기) 칸이면 그 색을 고른다.
 */
function labVote(source, wanted, protect) {
  const scale = Math.max(wanted, Math.max(source.w, source.h) / LAB_MAX_SIDE);
  const w = Math.max(1, Math.round(source.w / scale)), h = Math.max(1, Math.round(source.h / scale));
  const src = source.bytes, palette = labAutoPalette(source, LAB_VOTE_COLORS), K = palette.length;
  const luma = palette.map(c => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]);
  const nearest = new Int16Array(32768).fill(-1);
  const labelAt = i => {
    const key = ((src[i] >> 3) << 10) | ((src[i + 1] >> 3) << 5) | (src[i + 2] >> 3);
    if (nearest[key] < 0) nearest[key] = labNearest(src[i], src[i + 1], src[i + 2], palette);
    return nearest[key];
  };
  const spans = (n, size) => Array.from({ length: n }, (_, k) => { const a = Math.floor(k * size / n); return [a, Math.max(a + 1, Math.floor((k + 1) * size / n))]; });
  const xs = spans(w, source.w), ys = spans(h, source.h);
  // 가운데에 가까운 픽셀일수록 큰 표(가장자리는 1/4)
  const weight = (u, [a, b]) => 0.25 + 0.75 * (1 - Math.abs(u + 0.5 - (a + b) / 2) / ((b - a) / 2));
  const each = (x, y, visit) => {
    for (let v = ys[y][0]; v < ys[y][1]; v++) for (let u = xs[x][0]; u < xs[x][1]; u++) {
      const i = (v * source.w + u) * 4;
      if (src[i + 3] > 0) visit(i, src[i + 3] / 255, weight(u, xs[x]) * weight(v, ys[y]));
    }
  };
  // 칸마다 라벨별 넓이(area)와 표(votes). 절반 넘게 투명한 칸은 투명(-1).
  const area = new Float32Array(w * h * K), votes = new Float32Array(w * h * K), filled = new Float32Array(w * h), chosen = new Int16Array(w * h).fill(-1);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = y * w + x, base = c * K;
    each(x, y, (i, alpha, centre) => { const l = labelAt(i); area[base + l] += alpha; votes[base + l] += alpha * centre; filled[c] += alpha; });
    if (filled[c] < (ys[y][1] - ys[y][0]) * (xs[x][1] - xs[x][0]) * 0.5) continue;
    let best = 0;
    for (let l = 1; l < K; l++) if (votes[base + l] > votes[base + best]) best = l;
    chosen[c] = best;
  }
  let kept = 0;
  if (protect) {
    const picked = chosen.slice();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const c = y * w + x;
      if (picked[c] < 0) continue;
      // 둘레(3×3칸)에서 가장 넓은 색이 이 자리의 바탕색
      let ground = 0, most = -1;
      for (let l = 0; l < K; l++) {
        let sum = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < w && ny < h) sum += area[(ny * w + nx) * K + l];
        }
        if (sum > most) { most = sum; ground = l; }
      }
      // 바탕보다 뚜렷이 어두운 색들(선)·밝은 색들(하이라이트)이 이 칸과 옆 칸에서 차지하는 비율
      for (const side of [-1, 1]) {
        const member = l => (luma[l] - luma[ground]) * side >= LAB_DETAIL.contrast;
        const share = (nx, ny) => {
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || filled[ny * w + nx] === 0) return 0;
          let sum = 0;
          for (let l = 0; l < K; l++) if (member(l)) sum += area[(ny * w + nx) * K + l];
          return sum / filled[ny * w + nx];
        };
        const here = share(x, y);
        if (here < LAB_DETAIL.share) continue;
        // 절반을 넘거나, 양옆(또는 위아래)보다 많은 줄기 칸이면 디테일로 본다(영역의 가장자리는 한쪽이 더 많아 해당 없음)
        const ridge = (share(x - 1, y) < here && share(x + 1, y) <= here) || (share(x, y - 1) < here && share(x, y + 1) <= here);
        if (here <= 0.5 && !ridge) continue;
        let best = -1;
        for (let l = 0; l < K; l++) if (member(l) && (best < 0 || area[c * K + l] > area[c * K + best])) best = l;
        if (best >= 0 && area[c * K + best] > 0 && best !== picked[c]) { chosen[c] = best; kept++; }
        break;
      }
    }
  }
  // 색: 이긴 라벨을 가진 원본 픽셀의 평균(가운데 가중)
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = y * w + x;
    if (chosen[c] < 0) continue;
    let r = 0, g = 0, b = 0, n = 0;
    each(x, y, (i, alpha, centre) => { if (labelAt(i) === chosen[c]) { const t = alpha * centre; r += src[i] * t; g += src[i + 1] * t; b += src[i + 2] * t; n += t; } });
    out[c * 4] = Math.round(r / n); out[c * 4 + 1] = Math.round(g / n); out[c * 4 + 2] = Math.round(b / n); out[c * 4 + 3] = 255;
  }
  return { w, h, bytes: out, scale, kept };
}

/**
 * 외곽선 틈 메우기: 투명 배경과 맞닿은 가장자리 칸이 대부분 어두운 외곽선인 덩어리에서,
 * 외곽선 사이에 한 칸만 밝게 끊긴 곳을 옆 외곽선 색으로 메운다. 메운 칸 수를 돌려준다.
 * 덩어리(이어진 칸 묶음)마다 따로 본다: 흰 테두리 장식처럼 가장자리가 밝은 덩어리는 건드리지 않는다.
 */
function labRepairOutline(picture) {
  const { w, h, bytes: px } = picture;
  const solid = (x, y) => x >= 0 && y >= 0 && x < w && y < h && px[(y * w + x) * 4 + 3] > 0;
  if (!px.some((v, i) => i % 4 === 3 && v === 0)) return 0;
  const luma = i => 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
  const edge = new Uint8Array(w * h);   // 1: 밝은 가장자리 칸, 2: 어두운 가장자리 칸(외곽선)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!solid(x, y) || (solid(x - 1, y) && solid(x + 1, y) && solid(x, y - 1) && solid(x, y + 1))) continue;
    edge[y * w + x] = luma(y * w + x) < LAB_OUTLINE_DARK ? 2 : 1;
  }
  // 이어진 덩어리마다 가장자리의 60% 이상이 어두울 때만 그 덩어리의 틈을 메운다
  const seen = new Uint8Array(w * h), fixes = [];
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || px[start * 4 + 3] === 0) continue;
    const cells = [start];
    seen[start] = 1;
    for (let k = 0; k < cells.length; k++) {
      const x = cells[k] % w, y = (cells[k] / w) | 0;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (solid(nx, ny) && !seen[ny * w + nx]) { seen[ny * w + nx] = 1; cells.push(ny * w + nx); }
      }
    }
    const light = cells.filter(c => edge[c] === 1), dark = cells.filter(c => edge[c] === 2).length;
    if (dark < (dark + light.length) * 0.6) continue;
    for (const c of light) {
      const x = c % w, y = (c / w) | 0, near = [];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if ((dx || dy) && nx >= 0 && ny >= 0 && nx < w && ny < h && edge[ny * w + nx] === 2) near.push([nx, ny]);
      }
      // 서로 붙어 있지 않은 외곽선 칸 둘 사이에 낀 칸만 틈으로 본다.
      // 뒤(안쪽)에 밝은 면이 이어져 있을 때만 메운다: 리본 끝·흰 테두리처럼 한 칸 굵기인 밝은 부분은 메우면 사라지므로 둔다.
      const pair = near.find(([ax, ay]) => near.some(([bx, by]) => Math.abs(ax - bx) > 1 || Math.abs(ay - by) > 1));
      const backed = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].some(([nx, ny]) => solid(nx, ny) && edge[ny * w + nx] === 0 && luma(ny * w + nx) >= LAB_OUTLINE_DARK);
      if (pair && backed) fixes.push([c, pair[1] * w + pair[0]]);
    }
  }
  for (const [to, from] of fixes) { px[to * 4] = px[from * 4]; px[to * 4 + 1] = px[from * 4 + 1]; px[to * 4 + 2] = px[from * 4 + 2]; }
  return fixes.length;
}

/** 자동 추출: 그림에 쓰인 색을 가장 잘 대표하는 count색을 고른다(분산이 큰 쪽부터 나눈 뒤 몇 번 다듬기). */
function labAutoPalette(picture, count) {
  const bins = new Map(), px = picture.bytes;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] === 0) continue;
    const key = ((px[i] >> 3) << 10) | ((px[i + 1] >> 3) << 5) | (px[i + 2] >> 3);
    let bin = bins.get(key);
    if (!bin) bins.set(key, bin = [0, 0, 0, 0]);
    bin[0] += px[i]; bin[1] += px[i + 1]; bin[2] += px[i + 2]; bin[3]++;
  }
  const points = [...bins.values()].map(([r, g, b, n]) => [r / n, g / n, b / n, n]);
  if (points.length <= count) return points.map(p => [Math.round(p[0]), Math.round(p[1]), Math.round(p[2])]);
  // 색이 가장 넓게 퍼진(분산이 큰) 상자를 그 축의 평균에서 둘로 나눈다.
  // 픽셀 수의 중앙값으로 나누면 넓은 배경에 색을 다 써 버려서, 작은 영역의 또렷한 색이 탁하게 합쳐진다.
  const spread = box => {
    let best = { axis: 0, variance: 0, mean: 0 };
    for (let c = 0; c < 3; c++) {
      let sum = 0, n = 0;
      for (const p of box) { sum += p[c] * p[3]; n += p[3]; }
      const m = sum / n;
      let variance = 0;
      for (const p of box) variance += (p[c] - m) * (p[c] - m) * p[3];
      if (variance > best.variance) best = { axis: c, variance, mean: m };
    }
    return best;
  };
  const boxes = [points];
  while (boxes.length < count) {
    let pick = -1, chosen = null;
    boxes.forEach((box, k) => {
      if (box.length < 2) return;
      const s = spread(box);
      if (!chosen || s.variance > chosen.variance) { chosen = s; pick = k; }
    });
    if (pick < 0 || !(chosen.variance > 0)) break;
    const low = boxes[pick].filter(p => p[chosen.axis] <= chosen.mean), high = boxes[pick].filter(p => p[chosen.axis] > chosen.mean);
    if (low.length === 0 || high.length === 0) break;
    boxes.splice(pick, 1, low, high);
  }
  const mean = box => { let r = 0, g = 0, b = 0, n = 0; for (const p of box) { r += p[0] * p[3]; g += p[1] * p[3]; b += p[2] * p[3]; n += p[3]; } return [r / n, g / n, b / n]; };
  let palette = boxes.map(mean);
  for (let round = 0; round < 4; round++) {
    const groups = palette.map(() => []);
    for (const p of points) groups[labNearest(p[0], p[1], p[2], palette)].push(p);
    palette = palette.map((c, k) => (groups[k].length ? mean(groups[k]) : c));
  }
  return palette.map(c => [Math.round(c[0]), Math.round(c[1]), Math.round(c[2])]);
}

function labNearest(r, g, b, palette) {
  let best = 0, closest = Infinity;
  for (let k = 0; k < palette.length; k++) {
    const dr = r - palette[k][0], dg = g - palette[k][1], db = b - palette[k][2];
    const d = dr * dr + dg * dg * 2 + db * db;
    if (d < closest) { closest = d; best = k; }
  }
  return best;
}

/**
 * 실험 탭 결과 한 장: 줄이기(평균/투표) → 외곽선 틈 메우기 → 팔레트 색으로 바꾸기. 메이플 램프는 maple.js가 색까지 정한다.
 * options: { wanted: 원본 몇 픽셀을 한 칸으로, method, protect, repair, palette: 커스텀 색 [[r,g,b]…] 또는 null(자동), count, maple: 메이플 램프 설정 }
 */
function labCompute(source, options) {
  if (options.method === 'maple') return labMaple(source, options);
  const voting = options.method === 'vote';
  const small = voting ? labVote(source, options.wanted, options.protect) : labShrink(source, options.wanted);
  const mended = voting && options.repair ? labRepairOutline(small) : 0;
  const palette = options.palette ?? labAutoPalette(small, options.count);
  const px = small.bytes, cache = new Map(), used = new Set();
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] === 0) continue;
    const key = (px[i] << 16) | (px[i + 1] << 8) | px[i + 2];
    let k = cache.get(key);
    if (k === undefined) cache.set(key, k = labNearest(px[i], px[i + 1], px[i + 2], palette));
    px[i] = palette[k][0]; px[i + 1] = palette[k][1]; px[i + 2] = palette[k][2];
    used.add(k);
  }
  return { w: small.w, h: small.h, bytes: px, scale: small.scale, kept: small.kept ?? 0, mended, used: used.size };
}

/** 메이플 램프: 평균 방식과 같은 칸 수로 maple.js에 맡긴다(팔레트는 쓰지 않음). */
function labMaple(source, options) {
  const scale = Math.max(options.wanted, Math.max(source.w, source.h) / LAB_MAX_SIDE);
  const w = Math.max(1, Math.round(source.w / scale)), h = Math.max(1, Math.round(source.h / scale));
  const built = mapleBuild(source, w, h, options.maple), used = new Set();
  for (let i = 0; i < built.bytes.length; i += 4) {
    if (built.bytes[i + 3]) used.add((built.bytes[i] << 16) | (built.bytes[i + 1] << 8) | built.bytes[i + 2]);
  }
  return { w, h, bytes: built.bytes, scale, kept: 0, mended: 0, used: used.size, materials: built.materials, specks: built.specks };
}
