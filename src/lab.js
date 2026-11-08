// PixelLab 작업실 화면. '작업 그림' 하나에 도구를 차례로 적용한다(결과를 작업 그림으로 쓰기 · 되돌리기).
// 여러 프레임 결과(8방향·애니메이션·옷 입히기)는 움직이는 미리보기와 스프라이트 시트로 보여 준다.
const labDefaults = { description: '', flash: true, maxColors: 0, numColors: 0, dither: false, complex: false, scale: 0.5, action: 'walking', frameCount: 8 };
state.lab = {
  tool: LAB_TOOLS[store.get('lab.tool', 'pro')] ? store.get('lab.tool', 'pro') : 'pro',
  work: null, history: [], result: null, frames: null, reference: null, mask: null, brush: 1,
  options: { ...labDefaults, ...store.get('lab.options', {}) },
  text: {},   // 도구마다 적은 문장
};
let labTimer = null;
/** Pro 변환에 보낼 그림: 고른 값, 없으면 도트화 탭에 이미지가 있을 때 원본, 아니면 작업 그림 */
const proSource = () => state.lab.proSource ?? (state.product ? 'subject' : 'work');

function setLab(key, value) {
  state.lab[key] = value;
  if (key === 'tool') store.set('lab.tool', value);
  update();
}
function setLabOption(key, value) {
  state.lab.options[key] = value;
  const { description, ...keep } = state.lab.options;
  store.set('lab.options', keep);
  update();
}
function useAsWork(picture) {
  const lab = state.lab;
  if (lab.work) lab.history.push(lab.work);
  if (lab.history.length > 20) lab.history.shift();
  lab.work = picture;
  lab.mask = null;
  update();
}
async function loadPictureFile(file) {
  const image = await decode(file);
  return { w: image.w, h: image.h, bytes: Raster.fromPremultiplied(image.data, image.w, image.h).straightBytes() };
}
function pickFile(onPicture) {
  const input = el('input', { type: 'file', accept: 'image/*' });
  input.onchange = async () => {
    const file = input.files[0];
    try { if (file) onPicture(await loadPictureFile(file), file.name); }
    catch (error) { state.error = error.message; update(); }
  };
  input.click();
}

async function runLab() {
  const lab = state.lab, tool = LAB_TOOLS[lab.tool], key = cloudKey.get('pixellab');
  if (!key || state.busy) return;
  const needsWork = lab.tool !== 'pro' && lab.tool !== 'outfit';
  if (needsWork && !lab.work) { state.error = '먼저 작업 그림을 가져와 주세요.'; update(); return; }
  const problem = needsWork && tool.check?.(lab.work);
  if (problem) { state.error = problem; update(); return; }
  const what = lab.tool === 'pro' ? (proSource() === 'subject' ? '도트화 탭 캐릭터 원본' : `작업 그림(${lab.work?.w}×${lab.work?.h})`) : lab.tool === 'outfit' ? '프레임과 참고 그림' : `작업 그림(${lab.work.w}×${lab.work.h})`;
  const flash = lab.tool === 'pro' && lab.options.flash ? ' · Pro Flash는 1장에 생성 6회' : '';
  if (!confirm(`${what}을(를) PixelLab(api.pixellab.ai)로 보내 '${tool.name}'을(를) 실행합니다.\n요금: PixelLab 생성 횟수·크레딧에서 차감되며 결과에 표시됩니다${flash}.\n\n계속할까요?`)) return;
  state.error = null;
  try {
    let source = lab.work;
    if (lab.tool === 'pro') {
      if (proSource() === 'subject') source = (await engine.request('subject', {}, '보낼 원본 준비 중')).subject;
      if (!source) throw new CloudError('이미지를 열거나, 다른 이미지를 넣어 작업 그림으로 고른 뒤 실행해 주세요.');
    }
    state.busy = `${tool.name} 보내는 중`;
    update();
    const out = await tool.run(key, { work: lab.work, source, mask: lab.mask, frames: lab.frames, reference: lab.reference },
      { ...lab.options, description: (lab.text[lab.tool] ?? '').trim() }, label => { state.busy = label; updateStatus(); });
    const frames = Boolean(tool.frames) && out.pictures.length > 1;
    lab.result = { pictures: out.pictures, frames, tool: lab.tool,
      status: `${tool.name} 완료 · ${out.pictures.length}장${usageText(out.usage)}${out.note ? ' · ' + out.note : ''}` };
    if (frames) lab.frames = out.pictures;
  } catch (error) {
    state.error = error instanceof CloudError ? error.message : `PixelLab 작업을 하지 못했습니다. (${error.message})`;
  }
  state.busy = null;
  update();
}

function labResultPicture() {
  const r = state.lab.result;
  if (r) return r.frames ? spriteSheet(r.pictures) : r.pictures[0];
  return state.lab.work;
}

/** 작업 그림 미리보기. 부분 다시 그리기면 그 위에 붓으로 칠할 수 있다(빨강 = 다시 그릴 곳). */
function workPreview() {
  const lab = state.lab, p = lab.work, painting = lab.tool === 'inpaint' && p;
  const box = preview(painting ? '작업 그림 · 다시 그릴 곳을 칠하세요' : '작업 그림', p, true);
  if (!painting) return box;
  lab.mask ??= new Uint8Array(p.w * p.h);
  const canvas = box.querySelector('canvas');
  const base = toCanvas(p);
  const paint = () => {
    const g = canvas.getContext('2d');
    g.clearRect(0, 0, p.w, p.h);
    g.drawImage(base, 0, 0);
    g.fillStyle = 'rgba(255, 40, 60, 0.6)';
    for (let i = 0; i < lab.mask.length; i++) if (lab.mask[i]) g.fillRect(i % p.w, (i / p.w) | 0, 1, 1);
  };
  let drawing = false, erase = false;
  const stamp = event => {
    const rect = canvas.getBoundingClientRect(), scale = Math.min(rect.width / p.w, rect.height / p.h);
    const x = Math.floor((event.clientX - rect.left - (rect.width - p.w * scale) / 2) / scale);
    const y = Math.floor((event.clientY - rect.top - (rect.height - p.h * scale) / 2) / scale);
    const r = lab.brush - 1;
    for (let v = y - r; v <= y + r; v++) for (let u = x - r; u <= x + r; u++) {
      if (u >= 0 && v >= 0 && u < p.w && v < p.h) lab.mask[v * p.w + u] = erase ? 0 : 1;
    }
    paint();
  };
  canvas.style.cursor = 'crosshair';
  canvas.style.touchAction = 'none';
  canvas.onpointerdown = event => { drawing = true; erase = event.button === 2 || event.shiftKey; canvas.setPointerCapture(event.pointerId); stamp(event); };
  canvas.onpointermove = event => { if (drawing) stamp(event); };
  canvas.onpointerup = () => { drawing = false; };
  canvas.oncontextmenu = event => event.preventDefault();
  paint();
  return box;
}

/** 여러 프레임: 움직이는 미리보기 + 아래에 프레임 줄 */
function framesPreview(frames, title) {
  const box = preview(title, frames[0], true);
  const canvas = box.querySelector('canvas');
  let n = 0;
  clearInterval(labTimer);
  labTimer = setInterval(() => {
    if (!canvas.isConnected) return clearInterval(labTimer);
    n = (n + 1) % frames.length;
    const f = frames[n];
    canvas.width = f.w; canvas.height = f.h;
    canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(f.bytes), f.w, f.h), 0, 0);
  }, 130);
  const strip = el('div', { className: 'strip' }, ...frames.map((f, i) => {
    const c = toCanvas(f);
    c.className = 'pixelated';
    c.title = `${i + 1}번 프레임 · 눌러서 작업 그림으로`;
    c.onclick = () => useAsWork(f);
    return c;
  }));
  box.append(strip);
  return box;
}

function labOptions() {
  const lab = state.lab, o = lab.options, busy = Boolean(state.busy);
  const text = (placeholder) => {
    const input = el('input', { type: 'text', className: 'wide', placeholder, value: lab.text[lab.tool] ?? '', disabled: busy });
    input.oninput = () => { lab.text[lab.tool] = input.value; };
    return input;
  };
  switch (lab.tool) {
    case 'pro': return el('div', { className: 'stack' }, row(labelled('보낼 그림', segmented([['subject', '도트화 탭 원본'], ['work', '작업 그림']], proSource(), v => setLab('proSource', v), busy, '보낼 그림')),
      el('span', { className: 'note', textContent: '작업 그림으로 하려면 \'다른 이미지 넣기…\'로 원하는 그림을 넣은 뒤 고르세요' })),
      row(segmented([[true, 'Pro Flash(빠르고 쌈)'], [false, 'Pro(고품질)']], o.flash, v => setLabOption('flash', v), busy, '변환 등급'),
      stepper(o.maxColors ? `최대 ${o.maxColors}색` : '색 수 자동', o.maxColors, 0, 64, 4, v => setLabOption('maxColors', v), busy),
      text('스타일 설명(선택, 영어 권장): clean 1px black outline, pastel colors')));
    case 'edit': return row(text('고칠 내용(영어 권장): make the outline thinner and black'));
    case 'inpaint': return row(labelled('붓 크기', segmented([[1, '1'], [2, '3'], [3, '5']], lab.brush, v => setLab('brush', v), busy, '붓 크기')),
      el('button', { type: 'button', textContent: '칠한 곳 지우기', disabled: busy, onclick: () => { lab.mask = null; update(); } }),
      el('span', { className: 'note', textContent: 'Shift를 누르고 칠하면 지워집니다' }),
      text('칠한 곳에 그릴 내용(영어 권장): closed smiling eyes'));
    case 'colors': return row(stepper(o.numColors ? `${o.numColors}색으로` : '색 수 자동', o.numColors, 0, 64, 2, v => setLabOption('numColors', v), busy),
      toggle('디더링(2×2)', o.dither, v => setLabOption('dither', v), busy));
    case 'background': return row(toggle('복잡한 배경용', o.complex, v => setLabOption('complex', v), busy));
    case 'resize': return row(segmented([[0.5, '절반'], [0.75, '3/4'], [1.5, '1.5배'], [2, '2배']], o.scale, v => setLabOption('scale', v), busy, '크기'),
      text('캐릭터 설명(영어): pink haired chibi girl'));
    case 'rotate': return row(text('캐릭터 설명(선택, 영어): pink haired chibi girl with white round body'));
    case 'animate': return row(segmented([[4, '4프레임'], [8, '8프레임'], [16, '16프레임']], o.frameCount, v => setLabOption('frameCount', v), busy, '프레임 수'),
      text('동작(영어): walking'));
    case 'outfit': return row(el('button', { type: 'button', textContent: lab.reference ? '참고 그림 바꾸기…' : '옷 참고 그림 불러오기…', disabled: busy,
      onclick: () => pickFile(p => { lab.reference = p; update(); }) }),
      lab.work && el('button', { type: 'button', textContent: '작업 그림을 참고 그림으로', disabled: busy, onclick: () => { lab.reference = lab.work; update(); } }),
      el('span', { className: 'muted', textContent: lab.frames ? `입힐 프레임 ${lab.frames.length}장 준비됨` : '입힐 프레임 없음(먼저 애니메이션·8방향)' }),
      text('추가 지시(선택, 영어): frames show the character from the side'));
    default: return null;
  }
}

function labScreen() {
  clearInterval(labTimer);
  const lab = state.lab, busy = Boolean(state.busy), key = cloudKey.get('pixellab');
  const tool = LAB_TOOLS[lab.tool];
  const sources = row(el('span', { textContent: '작업 그림:' }),
    el('button', { type: 'button', textContent: '도트화 결과 가져오기', disabled: busy || !state.product, onclick: () => useAsWork(state.product.dotted) }),
    el('button', { type: 'button', textContent: 'AI 보정 결과 가져오기', disabled: busy || !state.cloud.result, onclick: () => useAsWork(state.cloud.result.final) }),
    el('button', { type: 'button', textContent: '다른 이미지 넣기…', disabled: busy, onclick: () => pickFile(picture => useAsWork(picture)) }),
    el('button', { type: 'button', textContent: '되돌리기', disabled: busy || !lab.history.length, onclick: () => { lab.work = lab.history.pop(); lab.mask = null; update(); } }),
    el('span', { className: 'note', textContent: '이 탭에 이미지를 끌어다 놓아도 작업 그림이 됩니다' }));
  const page = el('div', { className: 'screen' },
    el('p', { className: 'muted', textContent: 'PixelLab의 여러 도구를 작업 그림에 차례로 적용합니다. 결과가 마음에 들면 \'작업 그림으로 쓰기\'를 눌러 이어서 작업하세요. 키는 AI 보정 탭의 PixelLab 키를 같이 씁니다.' }),
    keyRow('pixellab'),
    sources,
    row(labelled('도구', el('select', {
      disabled: busy, onchange: event => { setLab('tool', event.target.value); },
    }, ...Object.entries(LAB_TOOLS).map(([id, t]) => el('option', { value: id, textContent: t.name, selected: id === lab.tool })))),
    el('span', { className: 'muted', textContent: tool.note })),
    labOptions(),
    row(el('button', { type: 'button', className: 'primary', textContent: `${tool.name} 실행`, disabled: busy || !key, onclick: runLab }),
      el('span', { className: 'note', textContent: '실행하면 그림이 api.pixellab.ai로 전송되고 PixelLab 생성 횟수·크레딧이 차감됩니다(결과에 표시).' })),
  );
  const r = lab.result;
  const right = r
    ? (r.frames ? framesPreview(r.pictures, `결과 · ${r.pictures.length}프레임`) : preview(r.pictures.length > 1 ? `결과 1/${r.pictures.length}` : '결과', r.pictures[0], true))
    : preview('결과', null, true);
  page.append(el('div', { className: 'previews' }, workPreview(), right));
  if (r) {
    page.append(row(
      !r.frames && el('button', { type: 'button', textContent: '결과를 작업 그림으로 쓰기', disabled: busy, onclick: () => useAsWork(r.pictures[0]) }),
      !r.frames && state.product && el('button', { type: 'button', textContent: `캔버스(${state.product.dotted.w}×${state.product.dotted.h})에 맞춰 작업 그림으로`, disabled: busy,
        onclick: () => useAsWork(fitPicture(r.pictures[0], state.product.dotted.w, state.product.dotted.h)) }),
      r.frames && el('span', { className: 'muted', textContent: '프레임을 누르면 그 프레임이 작업 그림이 됩니다. PNG 저장은 스프라이트 시트(가로로 이어 붙임)로 저장합니다.' }),
    ));
  }
  page.append(statusLine('lab'));
  return page;
}
