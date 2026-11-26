// MobileSAM(Apache-2.0)의 Acly ONNX 변환본. 원본·클릭·마스크는 작업자 안에서 처리한다.
const SAM_SIZE = 1024;
let samModels = null, samImage = null;

async function samSessions(progress) {
  samModels ??= (async () => {
    const ort = await loadOrt(progress);
    const [encoder, decoder] = await Promise.all([aiFile('samEncoder', progress), aiFile('samDecoder', progress)]);
    progress('MobileSAM 모델 준비 중');
    const options = { executionProviders: ['wasm'] };
    const image = await ort.InferenceSession.create(encoder, options);
    try {
      const mask = await ort.InferenceSession.create(decoder, options);
      return { ort, image, mask };
    } catch (error) {
      await image.release();
      throw error;
    }
  })().catch(error => { samModels = null; throw error; });
  return samModels;
}

async function samEncode(source, id, model, progress) {
  if (samImage?.id === id) return samImage;
  samImage = null;
  progress('AI가 원본의 모양을 읽는 중');
  const { w, h, bytes } = source;
  const scale = SAM_SIZE / Math.max(w, h);
  const width = Math.max(1, Math.round(w * scale)), height = Math.max(1, Math.round(h * scale));
  const original = new OffscreenCanvas(w, h);
  original.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(bytes.buffer, bytes.byteOffset, bytes.byteLength), w, h), 0, 0);
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.fillStyle = '#fff';
  context.fillRect(0, 0, width, height);
  context.drawImage(original, 0, 0, width, height);
  const rgba = context.getImageData(0, 0, width, height).data;
  const rgb = new Float32Array(width * height * 3);
  for (let p = 0; p < width * height; p++) {
    rgb[p * 3] = rgba[p * 4];
    rgb[p * 3 + 1] = rgba[p * 4 + 1];
    rgb[p * 3 + 2] = rgba[p * 4 + 2];
  }
  const { image_embeddings } = await model.image.run({ input_image: new model.ort.Tensor('float32', rgb, [height, width, 3]) });
  samImage = { id, width, height, embedding: image_embeddings };
  return samImage;
}

async function samSelect(source, id, point, progress) {
  const model = await samSessions(progress);
  const { width, height, embedding } = await samEncode(source, id, model, progress);
  const { w, h, bytes } = source;
  progress('AI가 클릭한 부위를 찾는 중');
  const tensor = (values, dims) => new model.ort.Tensor('float32', Float32Array.from(values), dims);
  const { masks } = await model.mask.run({
    image_embeddings: embedding,
    point_coords: tensor([point[0] * width / w, point[1] * height / h, 0, 0], [1, 2, 2]),
    point_labels: tensor([1, -1], [1, 2]),
    mask_input: new model.ort.Tensor('float32', new Float32Array(256 * 256), [1, 1, 256, 256]),
    has_mask_input: tensor([0], [1]),
    orig_im_size: tensor([h, w], [2]),
  }, ['masks']);
  const mask = new Uint8Array(w * h);
  if (masks.dims.at(-2) !== h || masks.dims.at(-1) !== w || masks.data.length !== mask.length) {
    throw new DotError('부위 선택 결과 크기가 원본과 다릅니다.');
  }
  for (let i = 0; i < mask.length; i++) mask[i] = masks.data[i] > 0 && bytes[i * 4 + 3] > 0 ? 1 : 0;
  if (!mask.some(Boolean)) throw new DotError('이 위치에서 색이 있는 부위를 찾지 못했습니다. 영역 안쪽을 눌러 보세요.');
  return mask;
}
