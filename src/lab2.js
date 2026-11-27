// 실험실 2: 원본에 영역을 표시하고 같은 그림에서 도트화 방식을 비교한다.
const LAB2_MODES = [['protect', '중요 영역 보호'], ['flatten', '색면 정리'], ['ai', 'AI로 부위 선택']];
const lab2Initial = () => ({ mode: 'protect', input: null, results: {}, rectangles: [], mask: null,
  imageId: 0, size: '100', colors: '24', radius: '3', localEffect: 'protect' });

function lab2SetInput(picture, name) {
  const lab = state.lab2;
  Object.assign(lab, { input: { picture, name }, results: {}, rectangles: [], mask: null, imageId: lab.imageId + 1 });
  state.error = state.notice = null;
}

async function lab2Run() {
  const lab = state.lab2;
  if (state.busy || !lab.input) return;
  const { mode, input, rectangles, mask, localEffect } = lab;
  const effect = mode === 'ai' ? localEffect : mode;
  const integerIn = (value, min, max) => /^\d+$/.test(value) && +value >= min && +value <= max;
  if (!integerIn(lab.size, 16, 250) || !integerIn(lab.colors, 2, 64)) {
    state.error = '긴 변은 16~250px, 색 수는 2~64로 입력해 주세요.';
    update();
    return;
  }
  if (effect === 'flatten' && !integerIn(lab.radius, 1, 12)) {
    state.error = '색면 정리 반경은 1~12px로 입력해 주세요.';
    update();
    return;
  }
  if ((mode === 'protect' && !rectangles.length) || (mode === 'ai' && !mask)) return;
  state.notice = null;
  try {
    const options = { mode: effect, size: +lab.size, colors: +lab.colors, radius: +lab.radius,
      region: mode === 'ai' ? mask : null, local: mode === 'ai' };
    const { picture, colors } = await engine.request('lab2', { source: input.picture, options, rectangles: mode === 'protect' ? rectangles : null }, '실험실 2 도트화 중');
    lab.results[mode] = { picture, status: `${picture.w}×${picture.h}px · ${colors}색` };
  } catch (error) {
    state.error = error.message;
  }
  update();
}

async function lab2Select(point) {
  const lab = state.lab2;
  if (state.busy) return;
  state.notice = null;
  const source = lab.input.picture;
  const [x, y] = point.map(Math.floor);
  if (!source.bytes[(y * source.w + x) * 4 + 3]) {
    state.error = '투명 배경 위가 아닌 캐릭터 안쪽을 눌러 주세요.';
    update();
    return;
  }
  try {
    const { mask } = await engine.request('samSelect',
      { source, imageId: lab.imageId, point }, 'AI 부위 선택 준비 중');
    lab.mask = mask;
    delete lab.results.ai;
    state.notice = '부위를 선택했습니다. 적용할 효과를 고르고 ‘도트화’를 누르세요.';
  } catch (error) {
    state.error = error.message;
  }
  update();
}

function lab2Controls() {
  const lab = state.lab2, { mode } = lab, busy = Boolean(state.busy);
  const change = (key, value) => {
    if (key === 'localEffect' && lab[key] !== value) delete lab.results.ai;
    lab[key] = value;
    state.notice = state.error = null;
    update();
  };
  const modes = segmented(LAB2_MODES, mode, value => change('mode', value), busy, '실험실 2 변환 방식');
  const input = (key, label, min, max) => labelled(label, el('input', { type: 'number', min, max, step: 1,
    value: lab[key], disabled: busy, oninput: event => { lab[key] = event.target.value; } }));
  const effects = mode === 'ai' && segmented([['protect', '선택 부위 보호'], ['flatten', '선택 부위 색면 정리']],
    lab.localEffect, value => change('localEffect', value), busy, '선택 부위 처리 방식');
  const hasSelection = mode === 'protect' ? lab.rectangles.length > 0 : mode === 'ai' && Boolean(lab.mask);
  const clear = hasSelection && el('button', { type: 'button', textContent: '선택 지우기', disabled: busy, onclick: () => {
    if (mode === 'protect') lab.rectangles = [];
    else lab.mask = null;
    delete lab.results[mode];
    state.notice = state.error = null;
    update();
  } });
  const run = el('button', { type: 'button', className: 'primary', textContent: '도트화', onclick: lab2Run,
    disabled: busy || !lab.input || (mode !== 'flatten' && !hasSelection) });
  const reuse = state.original && el('button', { type: 'button', disabled: busy, textContent: '도트화 탭 원본 가져오기', onclick: () => {
    lab2SetInput(state.original, state.fileName);
    update();
  } });
  const hints = {
    protect: '눈·입·장식처럼 남기고 싶은 부위를 원본 위에서 드래그하세요. 여러 곳을 표시할 수 있습니다.',
    flatten: '원본에서 색면 안의 잔색을 먼저 정리합니다. 반경이 클수록 강하게 정리됩니다.',
    ai: '원본에서 머리카락이나 후드 안쪽을 클릭하세요. 첫 사용 시 MobileSAM 모델 약 45MB와 공통 AI 실행 파일을 받습니다.',
  };
  return el('div', { className: 'stack' }, row(modes), effects && row(effects),
    row(input('size', '긴 변(px)', 16, 250), input('colors', '색 수', 2, 64),
      (mode === 'flatten' || (mode === 'ai' && lab.localEffect === 'flatten')) && input('radius', '정리 반경(px)', 1, 12),
      run, clear, reuse),
    el('p', { className: 'note', textContent: hints[mode] }));
}

function lab2Pointer(canvas, event) {
  const bounds = canvas.getBoundingClientRect();
  const scale = Math.min(bounds.width / canvas.width, bounds.height / canvas.height);
  const x = (event.clientX - (bounds.left + (bounds.width - canvas.width * scale) / 2)) / scale;
  const y = (event.clientY - (bounds.top + (bounds.height - canvas.height * scale) / 2)) / scale;
  return [x, y];
}

function lab2Preview() {
  const lab = state.lab2;
  const { mode, input, results } = lab;
  if (!input) return el('button', { type: 'button', className: 'empty drop', onclick: () => $('file').click() },
    el('strong', { textContent: '이미지를 여기에 놓으세요' }), el('span', { textContent: '또는 눌러서 이미지 고르기' }));
  const source = input.picture;
  const original = preview(input.name ? `원본 · ${input.name}` : '원본', source, false);
  const canvas = original.querySelector('canvas');
  if (mode !== 'flatten') canvas.classList.add('select-region');

  const context = canvas.getContext('2d');
  const paint = drag => {
    context.putImageData(new ImageData(new Uint8ClampedArray(source.bytes.buffer, source.bytes.byteOffset, source.bytes.byteLength), source.w, source.h), 0, 0);
    if (mode !== 'protect') return;
    context.fillStyle = 'rgba(78, 210, 255, 0.26)';
    context.strokeStyle = '#42d5ff';
    context.lineWidth = Math.max(1, Math.max(source.w, source.h) / 350);
    for (const [x0, y0, x1, y1] of drag ? [...lab.rectangles, drag] : lab.rectangles) {
      context.fillRect(x0, y0, x1 - x0, y1 - y0);
      context.strokeRect(x0, y0, x1 - x0, y1 - y0);
    }
  };
  if (mode === 'protect') {
    paint();
    let start = null;
    const area = (a, b, max) => [Math.max(0, Math.floor(Math.min(a, b))), Math.min(max, Math.floor(Math.max(a, b)) + 1)];
    const box = event => {
      const [x, y] = lab2Pointer(canvas, event);
      const [x0, x1] = area(start[0], x, source.w), [y0, y1] = area(start[1], y, source.h);
      return [x0, y0, x1, y1];
    };
    canvas.onpointerdown = event => {
      if (state.busy || event.button !== 0 || !event.isPrimary) return;
      const [x, y] = lab2Pointer(canvas, event);
      if (x < 0 || x >= source.w || y < 0 || y >= source.h) return;
      start = [x, y];
      canvas.setPointerCapture(event.pointerId);
    };
    canvas.onpointermove = event => { if (start && event.isPrimary) paint(box(event)); };
    canvas.onpointercancel = () => { start = null; paint(); };
    canvas.onpointerup = event => {
      if (!start || !event.isPrimary) return;
      lab.rectangles.push(box(event));
      start = null;
      delete results.protect;
      state.notice = state.error = null;
      update();
    };
  } else if (mode === 'ai') {
    if (lab.mask) {
      const pixels = context.getImageData(0, 0, source.w, source.h);
      for (let i = 0; i < lab.mask.length; i++) {
        if (!lab.mask[i]) continue;
        const p = i * 4;
        pixels.data[p] *= 0.62;
        pixels.data[p + 1] = pixels.data[p + 1] * 0.62 + 74;
        pixels.data[p + 2] = pixels.data[p + 2] * 0.62 + 97;
      }
      context.putImageData(pixels, 0, 0);
    }
    canvas.onclick = event => {
      const [x, y] = lab2Pointer(canvas, event);
      if (x < 0 || x >= source.w || y < 0 || y >= source.h) return;
      lab2Select([x, y]);
    };
  }
  return el('div', { className: 'previews' }, original, preview('결과', results[mode]?.picture, true));
}
