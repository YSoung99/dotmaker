// 비교표와 같은 크기·배치에서 캐릭터만 줄여 투명 캔버스에 놓는다.
let magicKernel = null;
let pendingAdaptive = null;

function resizeNativeAdaptive(source, width, height) {
  return new Promise((resolve, reject) => {
    pendingAdaptive = { resolve, reject };
    self.postMessage({ type: 'adaptive-native', source, width, height }, [source.bytes.buffer]);
  });
}

function receiveNativeAdaptive({ bytes, error }) {
  const pending = pendingAdaptive;
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
  return out;
}

async function resizeDotSubject(method, subject, reduced, progress) {
  const { x, y, w, h } = reduced.contentRect;
  const source = { w: subject.grid.w, h: subject.grid.h, bytes: subject.straightBytes() };
  progress(`${dotMethodName(method)}로 캐릭터 축소 중`);
  let pixels;
  if (w > source.w || h > source.h) {
    pixels = enlargeDotSource(source, w, h);
  } else if (method === 'adaptive' && nativeAdaptiveAvailable) {
    pixels = await resizeNativeAdaptive(source, w, h);
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
