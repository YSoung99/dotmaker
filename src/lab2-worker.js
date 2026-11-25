import initPax, { downscale_rgba, WasmDownscaleConfig } from 'smart-downscaler/web';
import paxWasm from 'lab2-pax-wasm';
import { CellColorPicker, PixelationAlgorithm, PixelationMode, detectWithAlgorithm, pixelateImage, preloadWasm } from '@xprite/pixelate';

async function pax(picture, { size, colors }) {
  await initPax({ module_or_path: paxWasm });
  const { w, h, bytes } = picture;
  const scale = size / Math.max(w, h);
  const width = Math.max(1, Math.round(w * scale)), height = Math.max(1, Math.round(h * scale));
  const options = WasmDownscaleConfig.exact_colors();
  options.palette_size = colors;
  options.alpha_mode = 'preserve';
  const output = downscale_rgba(bytes, w, h, width, height, options);
  try {
    return { picture: { w: output.width, h: output.height, bytes: output.data }, detail: `${output.colors_used}색` };
  } finally {
    output.free();
  }
}

async function recover(picture) {
  await preloadWasm();
  const { w: width, h: height, bytes: data } = picture;
  const image = { width, height, data };
  const grid = detectWithAlgorithm(image, PixelationAlgorithm.Auto);
  if (!grid.reliable) throw new Error('일관된 도트 격자를 찾지 못했습니다. 이미 원래 크기인 도트 또는 일반 그림일 수 있습니다.');
  const output = pixelateImage(image, { mode: PixelationMode.RecoverGrid, grid, colorPicker: CellColorPicker.TwoStage });
  return { picture: { w: output.width, h: output.height, bytes: output.data }, detail: '추정 격자' };
}

self.onmessage = async ({ data }) => {
  try {
    const output = data.mode === 'pax' ? await pax(data.picture, data.options) : await recover(data.picture);
    self.postMessage(output, [output.picture.bytes.buffer]);
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
