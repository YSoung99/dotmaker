// 테스트용 작은 합성 그림(곧은 RGBA). 매번 같은 그림이 나온다.

/** 투명 배경 위 캐릭터 비슷한 그림: 어두운 외곽선, 명암 있는 몸통, 가는 선, 흰 하이라이트 */
export function character(w = 96, h = 80) {
  const bytes = new Uint8ClampedArray(w * h * 4);
  const cx = w / 2, cy = h / 2, r = Math.min(w, h) * 0.42;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const d = Math.hypot(x - cx, y - cy), i = (y * w + x) * 4;
    if (d > r) continue;
    const shade = Math.round(60 * (x - cx + y - cy) / (2 * r));
    let c = d > r - 2 ? [24, 18, 20] : y < cy - r * 0.3 ? [235 - shade, 120 - shade, 160 - shade] : [90 - shade, 140 - shade, 220 - shade];
    if (Math.abs(x - cx) < 1 && y > cy) c = [30, 30, 40];                // 가는 세로 선
    if (Math.hypot(x - cx - r * 0.3, y - cy + r * 0.35) < 2) c = [255, 255, 255];   // 하이라이트
    bytes.set([...c.map(v => Math.max(0, Math.min(255, v))), 255], i);
  }
  return { w, h, bytes };
}

/** 배경까지 꽉 찬 그림: 가로 줄무늬 그라데이션과 체크 무늬 */
export function scene(w = 120, h = 90) {
  const bytes = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, check = ((x >> 3) + (y >> 3)) & 1;
    bytes.set([Math.round(x * 255 / w), check ? 200 : 60, Math.round(y * 255 / h), 255], i);
  }
  return { w, h, bytes };
}
