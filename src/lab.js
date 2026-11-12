// 실험 탭(베타): 캐릭터를 오려 내지 않고 그림 전체를 배경째 도트로 바꾼다.
// 도트 크기(원본 몇 픽셀을 한 칸으로) 또는 결과 크기(긴 변 칸 수)와 색 뽑는 방식(자동 N색 / 커스텀 팔레트)만 고른다.
// 계산이 가벼워 작업자 없이 화면에서 바로 한다. 다른 탭의 결과에는 영향을 주지 않는다.

// 커스텀 팔레트 기본 16색: 옛 PC 느낌의 디지털 RGB 16색(앞 8개는 밝은 8색이라 8색만 써도 흰색·원색이 있다).
// 17번째부터는 4단계 RGB 조합으로 채운다.
const LAB_BASE16 = ['000000', '0000ff', 'ff0000', 'ff00ff', '00ff00', '00ffff', 'ffff00', 'ffffff',
  '808080', '000080', '800000', '800080', '008000', '008080', '808000', 'c0c0c0'];
const LAB_COUNTS = { auto: [8, 16, 32, 64, 256], custom: [8, 16, 32, 64] };
const LAB_MAX_SIDE = 512;

function labDefaultPalette() {
  const colors = [...LAB_BASE16], levels = ['00', '55', 'aa', 'ff'];
  for (const r of levels) for (const g of levels) for (const b of levels) {
    if (colors.length < 64 && !colors.includes(r + g + b)) colors.push(r + g + b);
  }
  return colors;
}

function labInitial() {
  const saved = store.get('lab.palette', null);
  const mode = store.get('lab.mode', 'auto') === 'custom' ? 'custom' : 'auto';
  const count = store.get('lab.count', 16), size = store.get('lab.size', 0);
  return {
    input: null,     // 이 탭에 따로 넣은 그림 { name, picture } — 없으면 도트화 탭에서 연 원본을 쓴다
    block: Math.min(32, Math.max(1, Number(store.get('lab.block', 4)) || 4)),
    size: sizeChoices().includes(size) ? size : 0,   // 결과 크기(긴 변 칸 수). 0이면 도트 크기대로
    mode,
    count: LAB_COUNTS[mode].includes(count) ? count : 16,
    palette: Array.isArray(saved) && saved.length === 64 && saved.every(c => /^[0-9a-f]{6}$/.test(c)) ? saved : labDefaultPalette(),
    result: null,    // { w, h, bytes }
    status: '',
  };
}

const labSource = () => state.lab.input?.picture ?? state.original;

function setLab(key, value) {
  const lab = state.lab;
  lab[key] = value;
  if (key === 'mode' && !LAB_COUNTS[value].includes(lab.count)) lab.count = 64;
  for (const k of ['block', 'size', 'mode', 'count', 'palette']) store.set('lab.' + k, lab[k]);
  lab.result = null;
  state.notice = null;
  update();
}

function setLabInput(picture, name) {
  state.lab.input = picture ? { picture, name } : null;
  state.lab.result = null;
  update();
}

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

/** 지금 설정으로 결과를 다시 만든다(그림이 없으면 아무것도 안 함). */
function labRun() {
  const lab = state.lab, source = labSource();
  if (!source) return;
  // 결과 크기를 골랐으면 긴 변이 그 칸 수가 되게 묶는다(원본이 더 작으면 키우지 않고 원본 크기 그대로).
  const longSide = Math.max(source.w, source.h);
  const wanted = lab.size ? Math.max(1, longSide / lab.size) : lab.block;
  const small = labShrink(source, wanted);
  const palette = lab.mode === 'custom'
    ? lab.palette.slice(0, lab.count).map(hex => [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)])
    : labAutoPalette(small, lab.count);
  const px = small.bytes, cache = new Map(), used = new Set();
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] === 0) continue;
    const key = (px[i] << 16) | (px[i + 1] << 8) | px[i + 2];
    let k = cache.get(key);
    if (k === undefined) cache.set(key, k = labNearest(px[i], px[i + 1], px[i + 2], palette));
    px[i] = palette[k][0]; px[i + 1] = palette[k][1]; px[i + 2] = palette[k][2];
    used.add(k);
  }
  lab.result = { w: small.w, h: small.h, bytes: px };
  const how = lab.size
    ? `긴 변 ${lab.size}칸에 맞춤${longSide < lab.size ? ' (원본이 더 작아 원본 크기 그대로)' : ''}`
    : `도트 크기 ${lab.block}px${small.scale > wanted ? ` (큰 그림이라 한 변 ${LAB_MAX_SIDE}칸으로 맞춤)` : ''}`;
  lab.status = `실험(베타) · ${small.w}×${small.h} px · ${how} · ${lab.mode === 'custom' ? '커스텀 팔레트' : '자동 추출'} ${lab.count}색 중 ${used.size}색 사용`;
}

function labControls() {
  const lab = state.lab, source = labSource(), off = !source;
  const count = el('select', { disabled: off, onchange: event => setLab('count', Number(event.target.value)) },
    ...LAB_COUNTS[lab.mode].map(v => el('option', { value: String(v), textContent: `${v}색`, selected: v === lab.count })));
  count.setAttribute('aria-label', '팔레트 색 수');
  const size = el('select', { disabled: off, onchange: event => setLab('size', Number(event.target.value)) },
    el('option', { value: '0', textContent: '도트 크기대로', selected: !lab.size }),
    ...sizeChoices().map(v => el('option', { value: String(v), textContent: `긴 변 ${v}칸`, selected: v === lab.size })));
  size.setAttribute('aria-label', '결과 크기');
  const swatches = lab.mode === 'custom' && el('div', { className: 'swatches' },
    ...lab.palette.slice(0, lab.count).map((hex, k) => {
      const input = el('input', { type: 'color', value: '#' + hex, title: `${k + 1}번 색 #${hex} — 눌러서 바꾸기`,
        onchange: () => setLab('palette', lab.palette.map((c, j) => (j === k ? input.value.slice(1).toLowerCase() : c))) });
      input.setAttribute('aria-label', `팔레트 ${k + 1}번 색`);
      return input;
    }));
  return el('div', { className: 'stack' },
    row(el('span', { textContent: '바꿀 그림:' }),
      el('span', { className: 'muted', textContent: lab.input ? `넣은 그림 '${lab.input.name}' (${lab.input.picture.w}×${lab.input.picture.h})`
        : state.original ? `도트화 탭에서 연 원본 (${state.original.w}×${state.original.h})` : '없음 — 이미지를 넣거나 열어 주세요' }),
      el('button', { type: 'button', textContent: '다른 이미지 넣기…', onclick: () => pickFile((picture, name) => setLabInput(picture, name)) }),
      lab.input && el('button', { type: 'button', textContent: '넣은 그림 빼기', onclick: () => setLabInput(null) })),
    row(labelled('결과 크기', size),
      stepper(`도트 크기 ${lab.block}px`, lab.block, 1, 32, 1, v => setLab('block', v), off || Boolean(lab.size)),
      labelled('색 뽑는 방식', segmented([['auto', '자동 추출'], ['custom', '커스텀 팔레트']], lab.mode, v => setLab('mode', v), off, '색 뽑는 방식')),
      labelled('팔레트 색 수', count)),
    swatches && row(swatches, el('button', { type: 'button', textContent: '기본 색으로', onclick: () => setLab('palette', labDefaultPalette()) })),
    el('p', { className: 'note', textContent: lab.mode === 'custom'
      ? '커스텀 팔레트: 정해 둔 색만 씁니다. 색 칸을 눌러 바꾸세요. 여러 그림의 색감을 맞추거나 옛 게임 느낌을 낼 때 좋고, 원본과 색이 많이 달라질 수 있습니다.'
      : '자동 추출: 그림에 쓰인 색과 가장 가까운 색을 골라 원본 색감을 유지합니다. 도트 크기는 원본 몇 픽셀을 한 칸으로 묶을지입니다(클수록 칸이 굵어짐). 결과 크기를 고르면 도트 크기 대신 긴 변을 그 칸 수에 맞춥니다.' }));
}
