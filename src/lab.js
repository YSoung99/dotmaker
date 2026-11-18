// 실험 탭(베타): 그림을 도트 크기·색 수만 골라 도트로 바꾼다. 배경 지우기를 끄면 그림 전체를 배경째 바꾼다.
// 도트 크기(원본 몇 픽셀을 한 칸으로) 또는 결과 크기(긴 변 칸 수)와 색 뽑는 방식(자동 N색 / 커스텀 팔레트)만 고른다.
// 계산(lab-core.js)은 작업자가 하고, 화면은 설정·결과 표시만 한다. 다른 탭의 결과에는 영향을 주지 않는다.

// 커스텀 팔레트 기본 16색: 옛 PC 느낌의 디지털 RGB 16색(앞 8개는 밝은 8색이라 8색만 써도 흰색·원색이 있다).
// 17번째부터는 4단계 RGB 조합으로 채운다.
const LAB_BASE16 = ['000000', '0000ff', 'ff0000', 'ff00ff', '00ff00', '00ffff', 'ffff00', 'ffffff',
  '808080', '000080', '800000', '800080', '008000', '008080', '808000', 'c0c0c0'];
const LAB_COUNTS = { auto: [8, 16, 32, 64, 256], custom: [8, 16, 32, 64] };
// 저장하고 되돌리기(설정 히스토리)에 쓰는 설정 이름
const LAB_KEYS = ['block', 'size', 'cutout', 'method', 'protect', 'repair', 'mode', 'count', 'palette',
  'mapleMaterials', 'mapleTones', 'mapleOutline', 'mapleHueShift', 'mapleBoundary'];
const LAB_OUTLINES = [['ink', '진한 잉크'], ['material', '재질 색'], ['none', '없음']];

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
  const count = store.get('lab.count', 16), size = store.get('lab.size', 0), method = store.get('lab.method', 'average');
  const between = (key, min, max, fallback) => Math.min(max, Math.max(min, Number(store.get(key, fallback)) || fallback));
  return {
    input: null,     // 이 탭에 따로 넣은 그림 { name, picture } — 없으면 도트화 탭에서 연 원본을 쓴다
    block: Math.min(32, Math.max(1, Number(store.get('lab.block', 4)) || 4)),
    size: sizeChoices().includes(size) ? size : 0,   // 결과 크기(긴 변 칸 수). 0이면 도트 크기대로
    cutout: store.get('lab.cutout', true) !== false,  // 배경 지우기(기본 켬)
    cut: null,       // 배경을 지운 그림 { from: 바꿀 그림, picture } — 못 지웠으면 picture가 null
    cutting: null,   // 지금 배경을 지우고 있는 그림
    method: ['vote', 'maple'].includes(method) ? method : 'average',   // 줄이는 방식: 평균 / 투표 / 메이플 램프
    protect: store.get('lab.protect', true) !== false,   // 투표: 작은 디테일 지키기
    repair: store.get('lab.repair', true) !== false,     // 투표: 외곽선 틈 메우기
    mapleMaterials: between('lab.mapleMaterials', 2, 16, 8),   // 메이플 램프: 재질 수
    mapleTones: between('lab.mapleTones', 2, 5, 3),            // 메이플 램프: 재질마다 음영 단계
    mapleOutline: LAB_OUTLINES.some(([v]) => v === store.get('lab.mapleOutline', 'ink')) ? store.get('lab.mapleOutline', 'ink') : 'ink',
    mapleHueShift: store.get('lab.mapleHueShift', true) !== false,
    mapleBoundary: store.get('lab.mapleBoundary', true) !== false,
    mode,
    count: LAB_COUNTS[mode].includes(count) ? count : 16,
    palette: Array.isArray(saved) && saved.length === 64 && saved.every(c => /^[0-9a-f]{6}$/.test(c)) ? saved : labDefaultPalette(),
    result: null,    // { w, h, bytes }
    running: null,   // 작업자에게 맡긴 계산 표(설정이 바뀌면 지난 결과는 버린다)
    status: '',
  };
}

const labSource = () => state.lab.input?.picture ?? state.original;

function setLab(key, value) {
  const lab = state.lab;
  rememberSettings('lab');
  lab[key] = value;
  if (key === 'mode' && !LAB_COUNTS[value].includes(lab.count)) lab.count = 64;
  for (const k of LAB_KEYS) store.set('lab.' + k, lab[k]);
  labReset();
  state.notice = null;
  update();
}

/** 결과를 비워 다음 그리기 때 다시 계산하게 한다. 아직 계산 중인 지난 결과는 받아도 버린다. */
function labReset() {
  state.lab.result = null;
  state.lab.running = null;
}

function setLabInput(picture, name) {
  state.lab.input = picture ? { picture, name } : null;
  labReset();
  update();
}

/** 배경 지우기: 작업자에게서 캐릭터만 남긴 그림을 받아 둔다(같은 그림은 한 번만). 못 지우면 그림 전체를 쓴다. */
async function labCutout(raw) {
  const lab = state.lab;
  if (lab.cutting === raw) return;
  lab.cutting = raw;
  await null;   // 화면을 그리는 도중에 불리므로, 그리기가 끝난 뒤에 요청한다
  const data = new Uint8Array(raw.bytes.length);
  for (let i = 0; i < data.length; i += 4) {
    const a = raw.bytes[i + 3];
    data[i] = Math.floor((raw.bytes[i] * a + 127) / 255);
    data[i + 1] = Math.floor((raw.bytes[i + 1] * a + 127) / 255);
    data[i + 2] = Math.floor((raw.bytes[i + 2] * a + 127) / 255);
    data[i + 3] = a;
  }
  try {
    const { subject } = await engine.request('cutout', { image: { w: raw.w, h: raw.h, data } }, '배경 지우는 중');
    lab.cut = { from: raw, picture: subject };
  } catch {
    lab.cut = { from: raw, picture: null };
    state.error = null;
  }
  if (lab.cutting === raw) lab.cutting = null;
  update();
}


/** 커스텀 팔레트(16진수 글자)를 [r, g, b] 목록으로 */
const labPaletteRGB = lab => lab.palette.slice(0, lab.count)
  .map(hex => [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)]);

/** 지금 설정으로 결과를 다시 만든다(그림이 없거나 이미 계산 중이면 아무것도 안 함). 계산은 작업자가 한다. */
function labRun() {
  const lab = state.lab, raw = labSource();
  if (!raw || lab.running) return;
  // 배경 지우기: 지운 그림이 아직 없으면 받아 온 뒤에 다시 불린다.
  if (lab.cutout && lab.cut?.from !== raw) { labCutout(raw); return; }
  const source = lab.cutout && lab.cut.picture ? lab.cut.picture : raw;
  const backdrop = !lab.cutout ? '' : lab.cut.picture ? ' · 배경 지움' : ' · 배경을 지우지 못해 그림 전체를 변환';
  // 결과 크기를 골랐으면 긴 변이 그 칸 수가 되게 묶는다(원본이 더 작으면 키우지 않고 원본 크기 그대로).
  const longSide = Math.max(source.w, source.h);
  const wanted = lab.size ? Math.max(1, longSide / lab.size) : lab.block;
  const maple = lab.method === 'maple';
  const options = { wanted, method: lab.method, protect: lab.protect, repair: lab.repair, count: lab.count,
    palette: lab.mode === 'custom' && !maple ? labPaletteRGB(lab) : null,
    maple: { materials: lab.mapleMaterials, tones: lab.mapleTones, outline: lab.mapleOutline, hueShift: lab.mapleHueShift, boundary: lab.mapleBoundary } };
  const ticket = lab.running = { options };
  // 화면을 그리는 도중에 불리므로, 그리기가 끝난 뒤에 맡긴다. 실패하면 설정을 바꿀 때까지 다시 시도하지 않는다.
  Promise.resolve().then(() => engine.submit('lab', { source, options }, '실험 탭 도트 계산 중', done => {
    if (lab.running !== ticket) return;
    lab.running = null;
    lab.result = { w: done.w, h: done.h, bytes: done.bytes };
    const how = lab.size
      ? `긴 변 ${lab.size}칸에 맞춤${longSide < lab.size ? ' (원본이 더 작아 원본 크기 그대로)' : ''}`
      : `도트 크기 ${lab.block}px${done.scale > wanted ? ` (큰 그림이라 한 변 ${LAB_MAX_SIDE}칸으로 맞춤)` : ''}`;
    const m = options.maple;
    const way = maple ? ` · 메이플 램프 · 재질 ${done.materials}개 · 음영 ${m.tones}단계 · 윤곽선 ${LAB_OUTLINES.find(([v]) => v === m.outline)[1]}`
        + `${m.hueShift ? ' · 휴 시프트' : ''}${m.boundary ? ' · 재질 경계선' : ''}${done.specks ? ` · 외톨이 음영 점 ${done.specks}칸 정리` : ''}`
      : options.method !== 'vote' ? '' : ` · 투표 방식${options.protect ? ` · 디테일 지킴 ${done.kept}칸` : ''}${options.repair ? ` · 외곽선 틈 메움 ${done.mended}칸` : ''}`;
    const colors = maple ? `${done.used}색 사용` : `${lab.mode === 'custom' ? '커스텀 팔레트' : '자동 추출'} ${lab.count}색 중 ${done.used}색 사용`;
    lab.status = `실험(베타) · ${done.w}×${done.h} px${backdrop}${way} · ${how} · ${colors}`;
  }));
}

function labControls() {
  const lab = state.lab, source = labSource(), off = !source, maple = lab.method === 'maple';
  const count = el('select', { disabled: off, onchange: event => setLab('count', Number(event.target.value)) },
    ...LAB_COUNTS[lab.mode].map(v => el('option', { value: String(v), textContent: `${v}색`, selected: v === lab.count })));
  count.setAttribute('aria-label', '팔레트 색 수');
  const size = el('select', { disabled: off, onchange: event => setLab('size', Number(event.target.value)) },
    el('option', { value: '0', textContent: '도트 크기대로', selected: !lab.size }),
    ...sizeChoices().map(v => el('option', { value: String(v), textContent: `긴 변 ${v}칸`, selected: v === lab.size })));
  size.setAttribute('aria-label', '결과 크기');
  const swatches = lab.mode === 'custom' && !maple && el('div', { className: 'swatches' },
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
      lab.input && el('button', { type: 'button', textContent: '넣은 그림 빼기', onclick: () => setLabInput(null) }),
      toggle('배경 지우기', lab.cutout, v => setLab('cutout', v), off,
        '캐릭터만 남기고 배경을 지운 뒤 도트로 바꿉니다. 끄면 그림 전체를 배경째 바꿉니다. 배경이 복잡한 그림은 처음 한 번 배경 분리 AI 파일을 받습니다.')),
    row(labelled('결과 크기', size),
      stepper(`도트 크기 ${lab.block}px`, lab.block, 1, 32, 1, v => setLab('block', v), off || Boolean(lab.size)),
      !maple && labelled('색 뽑는 방식', segmented([['auto', '자동 추출'], ['custom', '커스텀 팔레트']], lab.mode, v => setLab('mode', v), off, '색 뽑는 방식')),
      !maple && labelled('팔레트 색 수', count)),
    row(labelled('줄이는 방식', segmented([['average', '평균'], ['vote', '투표'], ['maple', '메이플 램프']], lab.method, v => setLab('method', v), off, '줄이는 방식')),
      lab.method === 'vote' && toggle('작은 디테일 지키기', lab.protect, v => setLab('protect', v), off,
        '칸보다 가는 선이나 눈 하이라이트처럼 작고 둘레와 밝기가 뚜렷이 다른 부분이 투표에서 져서 사라지지 않게 합니다.'),
      lab.method === 'vote' && toggle('외곽선 틈 메우기', lab.repair, v => setLab('repair', v), off,
        '배경을 지운 그림에서, 어두운 바깥 외곽선이 한 칸만 밝게 끊긴 곳을 옆 외곽선 색으로 메웁니다. 어두운 외곽선이 없는 그림은 건드리지 않습니다.'),
      el('span', { className: 'note', textContent: maple
        ? '메이플 램프: 비슷한 색을 재질로 묶고, 재질마다 밝기 단계(음영 램프)와 색 있는 윤곽선을 만듭니다. 게임 스킨처럼 명암과 색이 살아납니다.'
        : lab.method === 'vote'
        ? '투표: 칸마다 가장 넓은 색 영역을 고르고, 색은 그 영역의 원본 색으로 칠합니다. 경계가 탁해지지 않습니다.'
        : '평균: 칸 안의 색을 섞습니다. 부드럽지만 경계가 탁해질 수 있습니다.' })),
    maple && row(
      stepper(`재질 ${lab.mapleMaterials}개`, lab.mapleMaterials, 2, 16, 1, v => setLab('mapleMaterials', v), off),
      stepper(`음영 ${lab.mapleTones}단계`, lab.mapleTones, 2, 5, 1, v => setLab('mapleTones', v), off),
      labelled('윤곽선', segmented(LAB_OUTLINES, lab.mapleOutline, v => setLab('mapleOutline', v), off, '윤곽선 스타일'))),
    maple && row(
      toggle('휴 시프트', lab.mapleHueShift, v => setLab('mapleHueShift', v), off,
        '그림자 쪽은 보라·파랑 쪽으로, 밝은 쪽은 노랑 쪽으로 색상을 살짝 돌리고 어두운 단계의 채도를 올립니다. 무채색 재질은 그대로입니다.'),
      toggle('재질 경계선', lab.mapleBoundary, v => setLab('mapleBoundary', v), off,
        '색이 크게 다른 재질 두 덩어리가 맞닿는 곳에도 선을 그어 옷·머리·장식을 나눕니다. 작은 하이라이트·볼터치에는 긋지 않습니다.'),
      el('span', { className: 'note', textContent: '재질 수가 많을수록 색이 세밀해지고, 음영 단계가 많을수록 명암이 부드럽습니다. 혼자 튀는 음영 점은 자동으로 정리합니다.' })),
    swatches && row(swatches, el('button', { type: 'button', textContent: '기본 색으로', onclick: () => setLab('palette', labDefaultPalette()) })),
    !maple && el('p', { className: 'note', textContent: lab.mode === 'custom'
      ? '커스텀 팔레트: 정해 둔 색만 씁니다. 색 칸을 눌러 바꾸세요. 여러 그림의 색감을 맞추거나 옛 게임 느낌을 낼 때 좋고, 원본과 색이 많이 달라질 수 있습니다.'
      : '자동 추출: 그림에 쓰인 색과 가장 가까운 색을 골라 원본 색감을 유지합니다. 도트 크기는 원본 몇 픽셀을 한 칸으로 묶을지입니다(클수록 칸이 굵어짐). 결과 크기를 고르면 도트 크기 대신 긴 변을 그 칸 수에 맞춥니다.' }));
}
