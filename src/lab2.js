// 실험실 2: 변환과 격자 복원은 별도 작업자에서 실행한다.
const LAB2_MODES = [['pax', 'PAX 변환'], ['xprite', 'Xprite 격자 복원']];
const lab2Initial = () => ({ mode: 'pax', input: null, results: {}, size: '100', colors: '24' });

function lab2SetMode(mode) {
  state.lab2.mode = mode;
  state.notice = state.error = null;
  update();
}

function lab2SetInput(picture, name) {
  const lab = state.lab2;
  lab.input = { picture, name };
  delete lab.results.pax;
  delete lab.results.xprite;
}

function lab2WorkerRequest(mode, picture, options) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([$('lab2-worker-src').textContent], { type: 'text/javascript' }));
    let worker;
    const finish = () => { worker?.terminate(); URL.revokeObjectURL(url); };
    try {
      worker = new Worker(url, { type: 'module' });
      worker.onmessage = ({ data }) => { finish(); if (data.error) reject(new Error(data.error)); else resolve(data); };
      worker.onerror = event => { event.preventDefault(); finish(); reject(new Error(event.message || '실험실 작업자를 시작하지 못했습니다.')); };
      worker.onmessageerror = () => { finish(); reject(new Error('실험실 작업자 결과를 읽지 못했습니다.')); };
      worker.postMessage({ mode, picture, options });
    } catch (error) { finish(); reject(error); }
  });
}

async function lab2Activity(label, action) {
  if (state.busy) return;
  state.notice = state.error = null;
  state.operation = label;
  update();
  try { await action(); }
  catch (error) { state.error = error.message; }
  finally { state.operation = null; update(); }
}

function lab2Run() {
  const { mode, input, size, colors, results } = state.lab2;
  if (!input) return;
  const name = mode === 'pax' ? 'PAX' : 'Xprite';
  const integerIn = (value, min, max) => /^\d+$/.test(value) && +value >= min && +value <= max;
  if (mode === 'pax' && (!integerIn(size, 16, 512) || !integerIn(colors, 2, 64))) {
    state.error = '긴 변은 16~512px, 색 수는 2~64로 입력해 주세요.';
    update();
    return;
  }
  lab2Activity(`${name} 처리 중…`, async () => {
    const { picture, detail } = await lab2WorkerRequest(mode, input.picture, { size: +size, colors: +colors });
    results[mode] = { picture, status: `${name} · ${picture.w}×${picture.h}px · ${detail}` };
  });
}

function lab2Controls() {
  const lab = state.lab2, busy = Boolean(state.busy);
  const modes = row(segmented(LAB2_MODES, lab.mode, lab2SetMode, busy, '실험실 2 변환 방식'));
  const input = (key, min, max) => el('input', { type: 'number', min, max, step: 1, value: lab[key], disabled: busy,
    oninput: event => { lab[key] = event.target.value; } });
  const run = el('button', { type: 'button', className: 'primary', textContent: lab.mode === 'pax' ? 'PAX 변환' : '격자 복원 미리보기',
    disabled: busy || !lab.input, onclick: lab2Run });
  const cloud = state.cloud.result;
  const shared = lab.mode === 'xprite' ? (cloud?.corrected ? cloud.final : cloud?.ai) : state.original;
  const reuse = shared && el('button', { type: 'button', disabled: busy,
    textContent: lab.mode === 'xprite' ? 'AI 보정 이미지 가져오기' : '도트화 탭 원본 가져오기', onclick: () => {
      lab2SetInput(shared, lab.mode === 'xprite' ? (state.cloud.input?.name ?? state.fileName) : state.fileName);
      state.error = state.notice = null;
      update();
    } });
  return el('div', { className: 'stack' }, modes,
    row(lab.mode === 'pax' && labelled('긴 변(px)', input('size', 16, 512)), lab.mode === 'pax' && labelled('색 수', input('colors', 2, 64)), run, reuse),
    lab.mode === 'xprite' && el('p', { className: 'note', textContent: '확대되거나 흐려진 도트의 원래 격자를 추정합니다. 이미 원래 크기인 도트는 잘못 줄어들 수 있고 반투명은 사라질 수 있습니다.' }));
}

function lab2Preview() {
  const { mode, input, results } = state.lab2;
  if (!input) return el('button', { type: 'button', className: 'empty drop', onclick: () => $('file').click() },
    el('strong', { textContent: '이미지를 여기에 놓으세요' }), el('span', { textContent: '또는 눌러서 이미지 고르기' }));
  return el('div', { className: 'previews' }, preview(input.name ? `원본 · ${input.name}` : '원본', input.picture, false),
    preview('결과', results[mode]?.picture, true));
}
