// 모델을 내려받지 않고 설치판에서 영역 표시, 색면 정리와 PNG 저장 상태를 확인한다.
const lab2Expression = `(async () => {
  const button = name => [...document.querySelectorAll('#panel button')].find(node => node.textContent === name);
  const waitFor = async predicate => {
    for (let attempt = 0; attempt < 400; attempt++) {
      const status = document.querySelector('.status');
      if (status?.classList.contains('error')) throw new Error(status.textContent);
      const value = predicate();
      if (value) return value;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error('실험실 2 처리 시간 초과');
  };
  const fixture = Object.assign(document.createElement('canvas'), { width: 160, height: 120 });
  const context = fixture.getContext('2d');
  context.fillStyle = 'rgba(50,150,100,0.65)';
  context.fillRect(8, 8, 144, 104);
  context.fillStyle = '#772255';
  context.fillRect(70, 40, 12, 30);
  const blob = await new Promise(resolve => fixture.toBlob(resolve, 'image/png'));
  const transfer = new DataTransfer();
  transfer.items.add(new File([blob], '실험실 2 검증.png', { type: 'image/png' }));
  document.querySelector('[data-stage="lab2"]').click();
  document.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  const source = await waitFor(() => document.querySelector('.lab2 canvas'));
  const modes = [...document.querySelectorAll('[aria-label="실험실 2 변환 방식"] button')].map(node => node.textContent);
  const needsSelection = button('도트화').disabled;
  const rect = source.getBoundingClientRect();
  source.setPointerCapture = () => {};
  const pointer = (type, delta) => source.dispatchEvent(new PointerEvent(type, {
    button: 0, isPrimary: true, clientX: rect.left + rect.width / 2 + delta, clientY: rect.top + rect.height / 2 + delta
  }));
  pointer('pointerdown', -12);
  pointer('pointerup', 12);
  const measure = async () => {
    button('도트화').click();
    const result = await waitFor(() => document.querySelector('canvas[aria-label="결과"]'));
    const data = result.getContext('2d').getImageData(0, 0, result.width, result.height).data;
    return { size: [result.width, result.height], alpha: data.some((a, i) => i % 4 === 3 && a > 0 && a < 255),
      canSave: !document.getElementById('save').disabled };
  };
  const protectedResult = await measure();
  button('색면 정리').click();
  const flattened = await measure();
  button('AI로 부위 선택').click();
  const aiNeedsSelection = button('도트화').disabled && !!button('선택 부위 보호') && !!button('선택 부위 색면 정리');
  return { modes, needsSelection, protectedResult, flattened, aiNeedsSelection };
})()`;
const result = { size: [100, 75], alpha: true, canSave: true };
const lab2Expected = { modes: ['중요 영역 보호', '색면 정리', 'AI로 부위 선택'], needsSelection: true,
  protectedResult: result, flattened: result, aiNeedsSelection: true };
module.exports = { lab2Expression, lab2Expected };
