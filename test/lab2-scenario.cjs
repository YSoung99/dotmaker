// macOS 테스트 창과 Windows 설치판에서 같은 입력으로 WASM 변환·격자 복원을 확인한다.
const lab2Expression = `(async () => {
  const status = () => document.querySelector('.status');
  const waitFor = async predicate => {
    for (let i = 0; i < 400; i++) {
      if (status()?.classList.contains('error')) throw new Error(status().textContent);
      if (predicate()) return;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error('실험실 2 결과 시간 초과: ' + status()?.textContent);
  };
  const button = name => [...document.querySelectorAll('#panel button')].find(node => node.textContent === name);
  const result = () => document.querySelector('canvas[aria-label="결과"]');
  const makeCanvas = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });
  const native = makeCanvas(48, 36);
  const ctx = native.getContext('2d');
  for (let y = 1; y < 35; y++) for (let x = 1; x < 47; x++) {
    if ((x * 31 + y * 17 + x * y) % 13 < 4) continue;
    ctx.fillStyle = ['#1d2330', '#5d4e8a', '#d6ae68', 'rgba(40,120,220,.6)'][(x * 13 + y * 17 + x * y) % 4];
    ctx.fillRect(x, y, 1, 1);
  }
  const source = makeCanvas(native.width * 5, native.height * 5);
  const sourceContext = source.getContext('2d');
  sourceContext.imageSmoothingEnabled = false;
  sourceContext.drawImage(native, 0, 0, source.width, source.height);
  const blob = await new Promise(resolve => source.toBlob(resolve, 'image/png'));
  document.querySelector('[data-stage="lab2"]').click();
  const transfer = new DataTransfer();
  transfer.items.add(new File([blob], '실험실 2 검증.png', { type: 'image/png' }));
  document.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  await waitFor(() => button('PAX 변환') && !document.querySelector('#panel .primary').disabled);
  document.querySelector('#panel .primary').click();
  await waitFor(result);
  const pax = result();
  const data = pax.getContext('2d').getImageData(0, 0, pax.width, pax.height).data;
  const paxCheck = { size: [pax.width, pax.height], alpha: data.some((value, i) => i % 4 === 3 && value > 0 && value < 255) };
  button('Xprite 격자 복원').click();
  button('격자 복원 미리보기').click();
  await waitFor(result);
  const xprite = [result().width, result().height];
  const save = !document.getElementById('save').disabled;
  const modes = [...document.querySelectorAll('[aria-label="실험실 2 변환 방식"] button')].map(item => item.textContent);
  button('PAX 변환').click();
  const paxRestored = result().width === paxCheck.size[0];
  return { pax: paxCheck, xprite, save, modes, paxRestored };
})()`;

const lab2Expected = { pax: { size: [100, 75], alpha: true }, xprite: [48, 36], save: true,
  modes: ['PAX 변환', 'Xprite 격자 복원'], paxRestored: true };
module.exports = { lab2Expression, lab2Expected };
