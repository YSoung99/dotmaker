<div align="center">

# 🎨 도트메이커 (윈도우 프로그램 소스)

**캐릭터 그림을 넣으면 원본을 살린 도트(픽셀) 그림으로 바꿔 주는 프로그램**

<img src="docs/before-after.png" alt="원본 그림과 도트메이커 결과 비교" width="760">

</div>

---

## 💾 받기

| 운영체제 | 받기 | 설치 방법 |
|---|---|---|
| **윈도우** 10/11 (64비트) | [Releases](https://github.com/YSoung99/dotmaker/releases/latest)의 `DotMaker-…-win-x64.exe` | 받은 파일을 실행 → 설치 위치 고르고 **설치**. "Windows의 PC 보호" 창이 뜨면 **추가 정보 → 실행** |
| **맥** (Apple Silicon, macOS 14 이상) | [YSoung99/dotmaker-mac](https://github.com/YSoung99/dotmaker-mac/releases/latest) | 압축을 풀어 앱을 **응용 프로그램** 폴더로 옮긴 뒤 `xattr -dr com.apple.quarantine "<앱 경로>"` 한 번 실행 |

## ✨ 할 수 있는 것

- **원본 보존** 도트화(결과 크기 100×100 ~ 200×200), 원본 색 살림 · 베리 잉크 · 2.0 방식
- **AI 업스케일(ESRGAN)**: 도트화하기 전에 원본을 4배로 키워 흐린 선·잡티를 정리합니다. 자동(원본이 결과 크기의 4배보다 작을 때만) · 6B(더 깔끔) · v3(더 빠름) · 끄기 중에서 고르고, AI 보정 탭의 다시 그린 그림에도 적용됩니다. 모델은 프로그램에 들어 있습니다.
- 바깥 외곽선 1픽셀(원본 선 색) · 원본 색 맞추기 · 경계 섞인 색 정리, **JEV 부위별 진단 · 섞인 색 판정**([LLM Gateway](https://llmgateway.io) API 키 필요, 판정할 때 그림이 전송되고 요금은 내 계정에 청구)
- AI 보정: PixelLab · Gemini · OpenAI(각 서비스의 내 API 키 필요)
- 색 배경 그림의 배경 분리 AI(약 168MB)와 AI 실행 도구는 처음 쓸 때 한 번 받습니다.

## 🛠️ 직접 빌드하기

Node.js 18 이상이 필요합니다.

```bash
npm install
npm run dist:win   # src/ → dist/도트메이커.html → release/DotMaker-…-win-x64.exe
```

`desktop/models/`의 AI 업스케일 모델은 [dotmaker-mac의 scripts/export-esrgan.py](https://github.com/YSoung99/dotmaker-mac/blob/main/scripts/export-esrgan.py)로 공식 가중치에서 다시 만들 수 있습니다.

## 📄 라이선스

[MIT](LICENSE). 함께 쓰는 AI 파일은 각자의 라이선스를 따릅니다.

- AI 업스케일: [Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN) RealESRGAN_x4plus_anime_6B · realesr-animevideov3 (BSD-3-Clause) — `desktop/models/`는 ONNX로 바꾼 것
- 배경 분리: [skytnt/anime-seg](https://huggingface.co/skytnt/anime-seg) (Apache-2.0)
- 선 추출: [p1atdev/MangaLineExtraction-hf](https://huggingface.co/p1atdev/MangaLineExtraction-hf) (MIT) — `src/lines-graph.onnx`는 이 모델의 구조를 ONNX로 옮긴 것
- 실행 도구: [onnxruntime-web](https://github.com/microsoft/onnxruntime) (MIT) · 프로그램 본체: [Electron](https://www.electronjs.org/) (MIT)

README의 예시 고양이 그림은 이 저장소용으로 새로 그린 것입니다.
