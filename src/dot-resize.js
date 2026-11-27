// 비교표와 같은 크기·배치에서 캐릭터만 줄여 투명 캔버스에 놓는다.
let magicKernel = null;
let pendingAdaptive = null;
let adaptiveRequests = 0;

// source.bytes를 넘겨(transfer) 보내므로 부른 뒤에는 source.bytes를 다시 쓸 수 없다.
function resizeNativeAdaptive(source, width, height) {
  return new Promise((resolve, reject) => {
    const requestId = ++adaptiveRequests;
    pendingAdaptive = { requestId, resolve, reject };
    self.postMessage({ type: 'adaptive-native', requestId, source, width, height }, [source.bytes.buffer]);
  });
}

// 응답에 requestId가 없으면(예전 창 코드) 지금 기다리는 요청의 응답으로 본다.
function receiveNativeAdaptive({ requestId, bytes, error }) {
  const pending = pendingAdaptive;
  if (requestId !== undefined && requestId !== pending?.requestId) return;
  pendingAdaptive = null;
  if (error) pending?.reject(new DotError(error));
  else pending?.resolve(bytes);
}

function enlargeDotSource(source, width, height) {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sx = Math.floor((x + 0.5) * source.w / width);
    const sy = Math.floor((y + 0.5) * source.h / height);
    const offset = (sy * source.w + sx) * 4;
    out.set(source.bytes.subarray(offset, offset + 4), (y * width + x) * 4);
  }
  return { w: width, h: height, bytes: out };
}

/** 축소할 원본 바이트. 목표보다 작은 축만 가장 가까운 픽셀로 늘리고, 줄어드는 축은 고른 축소 방식에 맡긴다. */
function dotSource(subject, w, h) {
  const source = { w: subject.grid.w, h: subject.grid.h, bytes: subject.straightBytes() };
  if (w <= source.w && h <= source.h) return source;
  return enlargeDotSource(source, Math.max(w, source.w), Math.max(h, source.h));
}

async function resizeDotSubject(method, subject, reduced, progress) {
  const { x, y, w, h } = reduced.contentRect;
  const source = dotSource(subject, w, h);
  progress(`${dotMethodName(method)}로 캐릭터 축소 중`);
  let pixels;
  if (source.w === w && source.h === h) {
    pixels = source.bytes;
  } else if (method === 'adaptive' && nativeAdaptiveAvailable) {
    try {
      pixels = await resizeNativeAdaptive(source, w, h);
    } catch {
      // 네이티브 헬퍼가 실패하면 같은 결과를 내는 wasm으로 한 번 더 한다. 보낸 바이트는 넘겨져 비었으니 새로 만든다.
      progress(`${dotMethodName(method)}를 다른 방식으로 다시 시도 중`);
      ({ bytes: pixels } = await resizeImago('adaptive', dotSource(subject, w, h), w, h));
    }
  } else if (method === 'mks') {
    magicKernel ??= self.pica({ features: ['js'] });
    pixels = await magicKernel.resizeBuffer({ src: source.bytes, width: source.w, height: source.h,
      toWidth: w, toHeight: h, filter: 'mks2013' });
  } else {
    ({ bytes: pixels } = await resizeImago(method, source, w, h));
  }
  const width = reduced.image.grid.w, height = reduced.image.grid.h;
  const canvas = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < h; row++) {
    const start = row * w * 4;
    canvas.set(pixels.subarray(start, start + w * 4), ((row + y) * width + x) * 4);
  }
  return Raster.fromStraight(canvas, width, height);
}

async function renderDot(subject, reduced, settings, progress, candidates = null) {
  const { method } = settings;
  if (method === 'faithful') return render(subject, reduced, settings);
  let image = candidates?.get(method);
  if (!image) {
    image = await resizeDotSubject(method, subject, reduced, progress);
    candidates?.set(method, image);
  }
  return finishDot({ image }, settings);
}
