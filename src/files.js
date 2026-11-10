// AI 파일 목록과 브라우저 저장소(IndexedDB). 화면과 작업자(worker) 양쪽에서 쓴다.
// 처음 한 번 인터넷에서 받거나, 사용자가 직접 받은 파일을 'AI 파일 불러오기'로 넣으면 여기에 저장된다.
const ORT_BASE = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/';
const AI_FILES = {
  ortJs: { name: 'ort.webgpu.min.js', size: 66417, url: ORT_BASE + 'ort.webgpu.min.js', title: 'AI 실행 도구 (onnxruntime-web 1.30.0)', use: '배경 분리·선 추출·AI 업스케일 공통 (설치형 프로그램에는 들어 있음)' },
  ortMjs: { name: 'ort-wasm-simd-threaded.asyncify.mjs', size: 53057, url: ORT_BASE + 'ort-wasm-simd-threaded.asyncify.mjs', title: 'AI 실행 도구 연결 파일', use: '배경 분리·선 추출·AI 업스케일 공통 (설치형 프로그램에는 들어 있음)' },
  ortWasm: { name: 'ort-wasm-simd-threaded.asyncify.wasm', size: 26781914, url: ORT_BASE + 'ort-wasm-simd-threaded.asyncify.wasm', title: 'AI 실행 엔진', use: '배경 분리·선 추출·AI 업스케일 공통 (설치형 프로그램에는 들어 있음)' },
  segModel: { name: 'isnetis.onnx', size: 176069933, url: 'https://huggingface.co/skytnt/anime-seg/resolve/493cb60893f47441b26ec4fb9a306bce9e342982/isnetis.onnx', title: '배경 분리 모델 (skytnt/anime-seg, Apache-2.0)', use: '흰·밝은 단색·투명 배경이 아닌 이미지 열 때' },
  esr6b: { name: 'esrgan-anime-6b.onnx', size: 17939947, url: 'https://github.com/YSoung99/dotmaker/releases/download/models-esrgan/esrgan-anime-6b.onnx', title: 'AI 업스케일 모델 6B (Real-ESRGAN, BSD-3)', use: 'AI 업스케일 자동·6B (설치형 프로그램에는 들어 있음)' },
  esrV3: { name: 'esrgan-animevideo-v3.onnx', size: 2492858, url: 'https://github.com/YSoung99/dotmaker/releases/download/models-esrgan/esrgan-animevideo-v3.onnx', title: 'AI 업스케일 모델 v3 (Real-ESRGAN, BSD-3)', use: 'AI 업스케일 자동·v3 (설치형 프로그램에는 들어 있음)' },
  linesModel: { name: 'model.safetensors', size: 86354074, url: 'https://huggingface.co/p1atdev/MangaLineExtraction-hf/resolve/3c815256f6f9be1ead162e8caaee63b489731d00/model.safetensors', title: '선 추출 모델 (MangaLineExtraction, MIT)', use: "'선 추출 AI로 빠진 선 채우기'를 켤 때" },
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
