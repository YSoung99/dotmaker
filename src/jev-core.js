// JEV(LLM Gateway 판정 모델)에 물을 항목 만들기. 작업자 안에서 돈다(맥 시험판 JevDetails.swift에서 옮김).
// 항목마다 원본 확대·후보 그림, 선택지, 후보를 고르면 바꿀 칸(edits)을 담는다. 요청과 화면은 jev-app.js가 맡는다.

const jevPicture = raster => ({ w: raster.grid.w, h: raster.grid.h, bytes: raster.straightBytes() });
/** 화면으로 보낼 그림 한 장. nearest: 도트 그대로 확대, gray: 깔 배경 밝기(0~1) */
const jevImage = (raster, nearest, gray = 0.88) => ({ picture: jevPicture(raster), nearest, gray });
const editList = map => [...map].map(([i, p]) => [i, p]);

function jevCropRect(reduced, centerX, centerY, span) {
  const box = reduced.contentRect;
  const w = Math.min(span, box.w), h = Math.min(span, box.h);
  return {
    x: Math.min(Math.max(box.x, centerX - Math.trunc(w / 2)), box.x + box.w - w),
    y: Math.min(Math.max(box.y, centerY - Math.trunc(h / 2)), box.y + box.h - h),
    w, h,
  };
}
const inside = (rect, i, w) => { const x = i % w, y = (i / w) | 0; return x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h; };
const cropTo = (raster, rect) => raster.crop(rect.x, rect.y, rect.w, rect.h);

function referenceCrop(subject, reduced, rect) {
  const box = reduced.contentRect;
  const sx = subject.grid.w / box.w, sy = subject.grid.h / box.h;
  const x = Math.floor((rect.x - box.x) * sx), y = Math.floor((rect.y - box.y) * sy);
  const right = Math.min(subject.grid.w, Math.ceil((rect.x + rect.w - box.x) * sx));
  const bottom = Math.min(subject.grid.h, Math.ceil((rect.y + rect.h - box.y) * sy));
  return subject.crop(x, y, right - x, bottom - y);
}

/** 가장자리 칸은 모양을 빙 둘러서 평균 위치가 몸 안쪽에 잡히기 쉽다. 대상 칸이 가장 많이 들어오는 칸을 가운데로. */
function jevFocus(points, reduced, w, span) {
  const rect = i => jevCropRect(reduced, i % w, (i / w) | 0, span);
  const count = r => points.filter(i => inside(r, i, w)).length;
  const stride = Math.max(1, Math.trunc(points.length / 200));
  let best = points[0], bestCount = -1;
  for (let k = 0; k < points.length; k += stride) {
    const c = count(rect(points[k]));
    if (c > bestCount) { best = points[k]; bestCount = c; }
  }
  return { rect: rect(best), x: best % w, y: (best / w) | 0 };
}

const firstMaxBy = (items, size) => items.reduce((best, item) => (best === undefined || size(item) > size(best) ? item : best), undefined);

function lineProbes(subject, reduced, current) {
  const grid = current.grid, cells = reduced.cells, w = grid.w;
  const depth = grid.depths(cells.map(c => c.cover >= 116));
  const ink = Array.from(depth, (d, i) => d > 0 && cells[i].dark >= 48);
  const center = Uint8Array.from(ink, Boolean);
  LineCleanup.skeletonize(center, grid);
  const wider = center.slice();
  for (let i = 0; i < center.length; i++) {
    if (!center[i]) continue;
    let best = -1;
    grid.each4(i, j => { if (ink[j] && !center[j] && cells[j].dark > (best < 0 ? -1 : cells[best].dark)) best = j; });
    if (best >= 0) wider[best] = 1;
  }
  const thin = new Map(), thick = new Map(), changes = [];
  for (let i = 0; i < ink.length; i++) {
    if (!(ink[i] && wider[i] && !center[i])) continue;
    const pixel = current.px[i];
    let fill = cells[i].fill;
    if (light(fill) < 112) {
      let neighbor = -1;
      grid.each8(i, j => {
        const cell = cells[j];
        const closest = neighbor < 0 ? Infinity : distance(cells[neighbor].fill, pixel);
        if (depth[j] > 0 && cell.dark < 30 && light(cell.fill) >= 112 && distance(cell.fill, pixel) < closest) neighbor = j;
      });
      if (neighbor < 0) continue;
      fill = cells[neighbor].fill;
    }
    thin.set(i, withAlpha(fill, A(pixel)));
    thick.set(i, withAlpha(cells[i].ink, A(pixel)));
    changes.push(i);
  }
  const box = reduced.contentRect;
  const span = Math.max(8, Math.min(28, Math.min(box.w, box.h)));
  const probes = [];
  for (const [id, title, points] of [['outer', '바깥 윤곽', changes.filter(i => depth[i] <= 2)], ['inner', '안쪽 선', changes.filter(i => depth[i] > 2)]]) {
    if (points.length === 0) continue;
    // 같은 종류 선의 바뀌는 칸이 가장 많이 모인 구역을 보여 준다.
    const tiles = new Map();
    for (const i of points) {
      const key = Math.trunc(i / w / span) * w + Math.trunc((i % w) / span);
      if (!tiles.has(key)) tiles.set(key, []);
      tiles.get(key).push(i);
    }
    const group = firstMaxBy([...tiles.keys()].sort((a, b) => a - b).map(k => tiles.get(k)), g => g.length);
    if (!group || group.length < 2) continue;
    const cx = Math.trunc(group.reduce((s, i) => s + (i % w), 0) / group.length);
    const cy = Math.trunc(group.reduce((s, i) => s + ((i / w) | 0), 0) / group.length);
    const rect = jevCropRect(reduced, cx, cy, span);
    const a = current.clone(), b = current.clone();
    for (const i of points) if (inside(rect, i, w)) { a.px[i] = thin.get(i); b.px[i] = thick.get(i); }
    probes.push({
      id, title: `${title} · 좌표 ${cx}, ${cy}`,
      instructions: `For group ${id}, compare its reference crop with A and B. Focus on ${id === 'outer' ? 'the outside contour' : 'the internal stroke'} where the options differ. Which stroke width looks more natural and faithful at sprite size? Ignore differences elsewhere. If both look similar or the reference is ambiguous, choose unclear.`,
      images: [jevImage(referenceCrop(subject, reduced, rect), false), jevImage(cropTo(a, rect), true), jevImage(cropTo(b, rect), true)],
      labels: ['원본 확대', '1픽셀 후보', '2픽셀 후보'],
      choices: [['Candidate A, thinner one-pixel stroke', '1픽셀'], ['Candidate B, thicker two-pixel stroke', '2픽셀'], ['Unclear or no material difference', '판단 유보']],
      edits: { 0: points.map(i => [i, thin.get(i)]), 1: points.map(i => [i, thick.get(i)]) },
      applyName: title,
    });
  }
  return probes;
}

function hairProbe(subject, reduced, current) {
  const grid = current.grid, cells = reduced.cells, w = grid.w, box = reduced.contentRect;
  const candidates = cells.map((c, i) => c.cover >= 150 && ((i / w) | 0) < box.y + box.h * 0.65 && chroma(c.fill) >= 28 && light(c.fill) >= 115);
  const area = firstMaxBy(grid.components(candidates), c => c.length);
  if (!area || area.length < 8) return null;
  const groups = new Map();
  for (const i of area) {
    const p = cells[i].fill, key = (Math.trunc(R(p) / 24) << 8) | (Math.trunc(G(p) / 24) << 4) | Math.trunc(B(p) / 24);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(i);
  }
  const members = firstMaxBy([...groups.keys()].sort((a, b) => a - b).map(k => groups.get(k)), g => g.length);
  const tone = cells[members[0]].fill;
  const adjusted = current.clone();
  for (const i of area) {
    if (cells[i].dark >= 18) continue;
    const pixel = current.px[i];
    if (distance(pixel, tone) >= 7500) continue;
    adjusted.px[i] = withAlpha(mixed(pixel, tone, 32), A(pixel));
  }
  const cx = Math.trunc(members.reduce((s, i) => s + (i % w), 0) / members.length);
  const cy = Math.trunc(members.reduce((s, i) => s + ((i / w) | 0), 0) / members.length);
  const rect = jevCropRect(reduced, cx, cy, 44);
  const a = cropTo(current, rect), b = cropTo(adjusted, rect);
  if (a.px.every((p, k) => p === b.px[k])) return null;
  return {
    id: 'hair', title: `머리색 후보 · 좌표 ${cx}, ${cy}`,
    instructions: 'For hair, inspect the reference crop and compare A and B where they differ. If the differing region is visibly hair, choose the candidate whose hue and highlight-to-shadow range matches the hair best. If it is not hair, or the difference is too small, choose unclear. Ignore line weight.',
    images: [jevImage(referenceCrop(subject, reduced, rect), false), jevImage(a, true), jevImage(b, true)],
    labels: ['원본 확대', '현재 머리색', '대표색에 가까운 후보'],
    choices: [['Candidate A, current color', '현재 색'], ['Candidate B, color closer to the sampled tone', '대표색 후보'], ['Unclear, no material difference, or the region is not hair', '판단 유보']],
    edits: { 1: area.filter(i => adjusted.px[i] !== current.px[i]).map(i => [i, adjusted.px[i]]) },
    applyName: '머리색',
  };
}

/** 같은 밝은·어두운 배경에 올렸을 때 기준 그림(원본을 그대로 평균 낸 축소)보다 확 밝아지거나 어두워진 바깥 칸 */
function edgeFindings(reduced, current) {
  const reference = reduced.image;
  const shown = (p, background) => Math.trunc((light(p) * A(p) + background * (255 - A(p))) / 255);
  const pale = [], dark = [];
  for (let i = 0; i < current.px.length; i++) {
    const now = current.px[i], was = reference.px[i];
    if (A(now) === 0 || A(was) >= 128) continue;
    if (shown(now, 36) - shown(was, 36) >= 60) pale.push(i);
    else if (shown(was, 245) - shown(now, 245) >= 60) dark.push(i);
  }
  return [{ id: 'edge_light', title: '투명 테두리 · 밝은 띠', points: pale, gray: 0.14 },
    { id: 'edge_dark', title: '투명 테두리 · 어두운 띠', points: dark, gray: 0.96 }];
}

function edgeProbe(finding, subject, reduced, current) {
  const w = current.grid.w;
  const { rect, x, y } = jevFocus(finding.points, reduced, w, 20);
  const marked = current.clone();
  for (const i of finding.points) if (inside(rect, i, w)) marked.px[i] = pack(255, 0, 255);
  const kind = finding.id === 'edge_light' ? 'pale, white or light' : 'dark or shadow-like';
  return {
    id: finding.id, title: `${finding.title} · 좌표 ${x}, ${y}`,
    instructions: `For group ${finding.id}, all three images show the same crop on the same solid background. The sprite crop is a small pixel-art version of the reference crop. In the marked crop, magenta pixels are where a measurement found a ${kind} fringe outside the silhouette. Looking at the unmarked sprite crop, is that fringe a visible halo or band that the reference does not have, or does the edge look natural?`,
    images: [jevImage(referenceCrop(subject, reduced, rect), false, finding.gray), jevImage(cropTo(current, rect), true, finding.gray), jevImage(cropTo(marked, rect), true, finding.gray)],
    labels: ['같은 배경의 원본', '현재 결과', '측정된 칸(분홍)'],
    imageNames: ['reference crop', 'sprite crop', 'marked crop'],
    choices: [['A visible fringe or halo the reference does not have', '띠가 보임'], ['The edge looks natural and consistent with the reference', '자연스러움'], ['Unclear at this scale', '판단 유보']],
    note: `측정 ${finding.points.length}칸`,
    edits: { 0: finding.points.map(i => [i, reduced.image.px[i]]) },
    applyName: finding.title, optionNames: { 0: '띠 지우기' },
  };
}

function outlineProbe(subject, reduced, current) {
  const w = current.grid.w, base = reduced.image, crisp = crispOutline(base);
  const changed = [];
  for (let i = 0; i < base.px.length; i++) if (base.px[i] !== crisp.px[i]) changed.push(i);
  if (changed.length < 3) return null;
  const soft = current.clone(), sharp = current.clone();
  for (const i of changed) { soft.px[i] = base.px[i]; sharp.px[i] = crisp.px[i]; }
  const { rect, x, y } = jevFocus(changed, reduced, w, 24);
  return {
    id: 'outline', title: `바깥 외곽선 · 좌표 ${x}, ${y}`,
    instructions: 'For group outline, compare the outer silhouette of A and B with the reference crop. A keeps the soft, semi-transparent or colored outer edge. B redraws the outermost edge as a crisp one-pixel black outline and removes faint pixels outside it. For a clean game sprite, which outer edge is better while staying true to the reference? If the reference clearly uses a light or colored outer outline rather than a dark one, prefer A. If both look equally good, choose unclear.',
    images: [jevImage(referenceCrop(subject, reduced, rect), false), jevImage(cropTo(soft, rect), true), jevImage(cropTo(sharp, rect), true)],
    labels: ['원본 확대', '원래 가장자리', '검은 1픽셀'],
    choices: [['Candidate A, the original soft or colored outer edge', '원래 가장자리'], ['Candidate B, a crisp one-pixel black outer outline', '검은 1픽셀'], ['Unclear or no material difference', '판단 유보']],
    edits: { 0: changed.map(i => [i, base.px[i]]), 1: changed.map(i => [i, crisp.px[i]]) },
    applyName: '바깥 외곽선',
  };
}

/** 섞인 칸이 몰린 부분 최대 4곳. 부분마다 그대로·가까운 색·선 색 쪽 중에서 고르게 한다. */
function blendProbes(subject, reduced, current) {
  const w = current.grid.w, base = reduced.image, all = blendCandidates(base), left = new Map(all), probes = [];
  while (probes.length < 4 && left.size >= 6) {
    const { rect, x, y } = jevFocus([...left.keys()], reduced, w, 16);
    const cells = [...left.keys()].filter(i => inside(rect, i, w));
    if (cells.length < 6) break;
    for (const i of cells) left.delete(i);
    const keep = current.clone(), near = current.clone(), dark = current.clone();
    for (const i of cells) { const pick = all.get(i); keep.px[i] = base.px[i]; near.px[i] = pick.near; dark.px[i] = pick.dark; }
    const n = probes.length + 1, id = `blend${n}`;
    probes.push({
      id, title: `섞인 색 ${n} · 좌표 ${x}, ${y} · ${cells.length}칸`,
      instructions: `For group ${id}, compare the reference crop with three sprite crops. Cells on color borders were averaged during downscaling into muddy in-between colors that the reference does not contain (e.g. maroon between red and black). Treat such muddy colors as defects. A keeps them. B snaps each blended cell to the nearer of the two colors it sits between. C snaps each blended cell to the darker color, making line work bolder. Which gives clean flat colors and line work that best follow the shapes in the reference? If B and C look equally good, choose unclear.`,
      images: [jevImage(referenceCrop(subject, reduced, rect), false), jevImage(cropTo(keep, rect), true), jevImage(cropTo(near, rect), true), jevImage(cropTo(dark, rect), true)],
      labels: ['원본 확대', '그대로', '가까운 색', '선 색 쪽'],
      imageNames: ['reference crop', 'candidate A', 'candidate B', 'candidate C'],
      choices: [['Candidate A, keep the blended colors', '그대로'], ['Candidate B, snap to the nearer color', '가까운 색'], ['Candidate C, snap to the darker line color', '선 색 쪽'], ['Unclear or no material difference', '판단 유보']],
      edits: { 0: cells.map(i => [i, base.px[i]]), 1: cells.map(i => [i, all.get(i).near]), 2: cells.map(i => [i, all.get(i).dark]) },
      applyName: `섞인 색 ${n}`,
    });
  }
  return probes;
}

/** 부위별 진단(details) 또는 섞인 색 판정(blends)에 쓸 항목 */
function jevProbes(subject, reduced, current, focus) {
  let probes = [], edges = [];
  if (focus === 'blends') {
    probes = blendProbes(subject, reduced, current);
  } else {
    probes = lineProbes(subject, reduced, current);
    const hair = hairProbe(subject, reduced, current);
    if (hair) probes.push(hair);
    edges = edgeFindings(reduced, current);
    for (const finding of edges) if (finding.points.length >= 3) probes.push(edgeProbe(finding, subject, reduced, current));
    const outline = outlineProbe(subject, reduced, current);
    if (outline) probes.push(outline);
    const choices = [['Clearly visible in the reference and absent or substantially weaker in the sprite', '누락 의심'], ['Retained, or not present in the reference', '뚜렷한 누락 없음'], ['Unclear at the given scale', '판단 유보']];
    for (const [id, title, feature] of [
      ['face', '눈·입·표정', 'eyes, eye highlights, mouth, or distinctive expression marks'],
      ['strokes', '머리카락·옷 안쪽 선', 'distinctive internal hair strands, folds or decorative strokes'],
      ['accessory', '장식·떨어진 소품', 'accessories, ribbons, symbols, and detached props'],
      ['shading', '작은 색·명암', 'small colored details, intentional highlights, and distinctive shading patches'],
    ]) {
      probes.push({ id, title, choices, images: [], labels: [], edits: {}, full: true,
        instructions: `Compare FULL reference with FULL sprite. Are any ${feature} clearly present in the reference but absent or substantially weaker in the sprite? Ignore expected differences in edge antialiasing.` });
    }
  }
  const cleanEdges = edges.filter(f => f.points.length < 3).map(f => ({ id: f.id, title: f.title, result: `뚜렷한 이상 없음 · 측정 ${f.points.length}칸` }));
  return { focus, probes, cleanEdges, full: [jevImage(subject, false), jevImage(current, true)], base: jevPicture(current) };
}
