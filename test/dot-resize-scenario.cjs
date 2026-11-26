// 설치형 화면에서 4가지 축소 방식을 바꾸고 앱의 크기 제한과 반투명 결과를 확인한다.
const dotResizeExpression = `(async () => {
  const status = () => document.querySelector('.status')?.textContent ?? '';
  const waitFor = async predicate => {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (document.querySelector('.status.error')) throw new Error(status());
      if (predicate()) return;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error('도트화 결과 시간 초과: ' + status());
  };
  const ready = () => !document.getElementById('save').disabled && !document.querySelector('.spinner');
  const options = group => [...document.querySelectorAll('[aria-label="' + group + '"] button')];
  const choose = (group, name) => options(group).find(button => button.textContent === name).click();
  const drop = async (canvas, name) => {
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], name, { type: 'image/png' }));
    document.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    await waitFor(() => ready() && document.querySelector('#file-name').textContent === name);
  };

  choose('AI 업스케일', '안 함');
  choose('도트화 방식', '원본 보존');
  const large = Object.assign(document.createElement('canvas'), { width: 2200, height: 48 });
  const ctx = large.getContext('2d');
  ctx.fillStyle = '#c06789';
  ctx.fillRect(5, 5, 2100, 38);
  await drop(large, '입력 상한.png');
  const limited = document.querySelector('canvas[aria-label="원본"]').width;

  const size = document.querySelector('[aria-label="결과 크기 목록"]');
  size.value = '70';
  size.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => ready() && status().includes('70×70'));
  const fixture = Object.assign(document.createElement('canvas'), { width: 164, height: 132 });
  const c = fixture.getContext('2d');
  c.fillStyle = 'rgba(50,150,100,0.65)';
  c.fillRect(6, 6, 148, 117);
  c.fillStyle = '#a02847';
  c.beginPath();
  c.ellipse(72, 55, 55, 23, 0.3, 0, 2 * Math.PI);
  c.fill();
  c.fillStyle = '#7f2255';
  c.fillRect(70, 53, 17, 8);
  await drop(fixture, '축소 테스트.png');

  const methods = options('도트화 방식').map(button => button.textContent);
  const fingerprints = [];
  let translucent = 0, sizes = 0;
  for (const method of methods.slice(1)) {
    choose('도트화 방식', method);
    await waitFor(() => ready() && status().startsWith(method));
    const result = document.querySelector('canvas[aria-label="결과"]');
    const data = result.getContext('2d').getImageData(0, 0, result.width, result.height).data;
    const digest = await crypto.subtle.digest('SHA-256', data);
    fingerprints.push([...new Uint8Array(digest)].join(','));
    if (result.width === 70 && result.height === 70) sizes++;
    if (data[3] === 0 && data.some((a, i) => i % 4 === 3 && a > 0 && a < 255)) translucent++;
  }
  return { methods, limited, sizes, translucent, distinct: new Set(fingerprints).size, noUpscale: status().includes('AI 업스케일 안 함') };
})()`;

const dotResizeExpected = {
  methods: ['원본 보존', 'DPID', 'SSIM 축소', '내용 적응형 축소', 'Magic Kernel Sharp'],
  limited: 2048, sizes: 4, translucent: 4, distinct: 4, noUpscale: true,
};
module.exports = { dotResizeExpression, dotResizeExpected };
