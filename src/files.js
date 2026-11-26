// AI 파일 목록과 브라우저 저장소(IndexedDB). 화면과 작업자(worker) 양쪽에서 쓴다.
// 처음 쓸 때 한 번 인터넷에서 받거나, 사용자가 직접 받은 파일을 'AI 파일 불러오기'로 넣으면 여기에 저장된다.
// sha256은 각 주소에서 실제로 받은 파일로 계산한 값이다(2026-11-18). 받기·넣기 모두 크기와 함께 내용도 맞춰 본다.
const ORT_BASE = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/';
const SAM_BASE = 'https://huggingface.co/Acly/MobileSAM/resolve/0d3b403339b4674a82493d5e97964dd78089ddc8/';
const AI_FILES = {
  samEncoder: { name: 'mobile_sam_image_encoder.onnx', size: 28157093, sha256: '580f5fb648ea1062c0aabc26217aed56921985f03f0cbbd852bba81d760cc749', url: SAM_BASE + 'mobile_sam_image_encoder.onnx', title: 'MobileSAM 이미지 모델 (Apache-2.0)', use: '실험실 2 · AI로 부위 선택' },
  samDecoder: { name: 'sam_mask_decoder_single.onnx', size: 16501323, sha256: '93915fc7c993ab9d59ab8c9ccd3bce37f7509c81ab4150a74abd4d2abbd8570d', url: SAM_BASE + 'sam_mask_decoder_single.onnx', title: 'MobileSAM 클릭 모델 (Apache-2.0)', use: '실험실 2 · AI로 부위 선택' },
  ortJs: { name: 'ort.webgpu.min.js', size: 66417, sha256: '7d65dad7eb4564ad98db9924a259af2e2c68ebfbdbf254fa5d728f1c5736e07a', url: ORT_BASE + 'ort.webgpu.min.js', title: 'AI 실행 도구 (onnxruntime-web 1.30.0)', use: '배경 분리·선 추출·AI 업스케일 공통' },
  ortMjs: { name: 'ort-wasm-simd-threaded.asyncify.mjs', size: 53057, sha256: '3d1c85995364bb643302fc6fd877a0c3ba5ae72401815e0f24828a53d9191e28', url: ORT_BASE + 'ort-wasm-simd-threaded.asyncify.mjs', title: 'AI 실행 도구 연결 파일', use: '배경 분리·선 추출·AI 업스케일 공통' },
  ortWasm: { name: 'ort-wasm-simd-threaded.asyncify.wasm', size: 26781914, sha256: '39f9f0894d478800487ed9f7dbe92618498db320cf55c8e3d89adff8dce658da', url: ORT_BASE + 'ort-wasm-simd-threaded.asyncify.wasm', title: 'AI 실행 엔진', use: '배경 분리·선 추출·AI 업스케일 공통' },
  segModel: { name: 'isnetis.onnx', size: 176069933, sha256: 'f15622d853e8260172812b657053460e20806f04b9e05147d49af7bed31a6e99', url: 'https://huggingface.co/skytnt/anime-seg/resolve/493cb60893f47441b26ec4fb9a306bce9e342982/isnetis.onnx', title: '배경 분리 모델 (skytnt/anime-seg, Apache-2.0)', use: '흰·밝은 단색·투명 배경이 아닌 이미지 열 때' },
  esr6b: { name: 'esrgan-anime-6b.onnx', size: 17939947, sha256: '55a7a3b4cc42ebef14e7fea68dae6cbdd30a517e0b30abf10bcb013ff3a75661', url: 'https://github.com/YSoung99/dotmaker/releases/download/models-esrgan/esrgan-anime-6b.onnx', title: 'AI 업스케일 모델 6B (Real-ESRGAN, BSD-3)', use: 'AI 업스케일 자동·6B' },
  esrV3: { name: 'esrgan-animevideo-v3.onnx', size: 2492858, sha256: 'a58d584b6cf32a43fc6a2f4e03ef97df1a2cf84d815d98adf3def25c9c6ac419', url: 'https://github.com/YSoung99/dotmaker/releases/download/models-esrgan/esrgan-animevideo-v3.onnx', title: 'AI 업스케일 모델 v3 (Real-ESRGAN, BSD-3)', use: 'AI 업스케일 자동·v3' },
  linesModel: { name: 'model.safetensors', size: 86354074, sha256: 'ea2fd106f2217f4e06a5d20c300e30a64c26a2f1f9e8068e114d2e9e040d2fa0', url: 'https://huggingface.co/p1atdev/MangaLineExtraction-hf/resolve/3c815256f6f9be1ead162e8caaee63b489731d00/model.safetensors', title: '선 추출 모델 (MangaLineExtraction, MIT)', use: "'선 추출 AI로 빠진 선 채우기'를 켤 때" },
};

const fileStore = {
  open() {
    return new Promise((done, failed) => {
      const request = indexedDB.open('dotmaker-ai', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('files');
      request.onerror = () => failed(request.error);
      request.onsuccess = () => done(request.result);
    });
  },
  async run(mode, action) {
    const db = await this.open();
    try {
      return await new Promise((done, failed) => {
        const op = action(db.transaction('files', mode).objectStore('files'));
        op.onsuccess = () => done(op.result);
        op.onerror = () => failed(op.error);
      });
    } finally {
      db.close();
    }
  },
  get(id) { return this.run('readonly', s => s.get(id)).catch(() => undefined); },
  async put(id, bytes) {
    try { await navigator.storage?.persist?.(); } catch { /* 저장 공간 보호 요청은 실패해도 그만 */ }
    return this.run('readwrite', s => s.put(bytes, id));
  },
  keys() { return this.run('readonly', s => s.getAllKeys()).catch(() => []); },
  clear() { return this.run('readwrite', s => s.clear()); },
};

/** 직접 넣은 파일이 어느 AI 파일인지 크기로 알아낸다(파일 크기가 모두 다르고, 이름은 받을 때 바뀔 수 있다). */
function identifyAIFile(size) {
  return Object.keys(AI_FILES).find(id => AI_FILES[id].size === size);
}

/** 파일 내용이 목록의 sha256과 같은지 본다. 크기만 같은 다른 파일이나 바뀐 실행 도구(importScripts로 실행됨)를 막는다. */
async function matchesHash(id, bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, b => b.toString(16).padStart(2, '0')).join('') === AI_FILES[id].sha256;
}
