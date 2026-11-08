<div align="center">

# 🎨 도트메이커

**캐릭터 그림을 넣으면 도트(픽셀) 그림으로 바꿔 주는 앱**

HTML 파일 하나로 윈도우 · 맥 · 리눅스에서 똑같이 돌아가요.

[![최신 버전](https://img.shields.io/github/v/release/YSoung99/dotmaker?label=%EC%B5%9C%EC%8B%A0%20%EB%B2%84%EC%A0%84&color=d94f8a)](https://github.com/YSoung99/dotmaker/releases/latest)
[![라이선스](https://img.shields.io/github/license/YSoung99/dotmaker?label=%EB%9D%BC%EC%9D%B4%EC%84%A0%EC%8A%A4)](LICENSE)
![지원 OS](https://img.shields.io/badge/%EC%A7%80%EC%9B%90-Windows%20%7C%20macOS%20%7C%20Linux-555)
![브라우저](https://img.shields.io/badge/%EB%B8%8C%EB%9D%BC%EC%9A%B0%EC%A0%80-Chrome%20%7C%20Edge-4285F4)

<img src="docs/before-after.png" alt="원본 그림과 도트메이커 결과 비교" width="760">

[**⬇️ 내려받기**](https://github.com/YSoung99/dotmaker/releases/latest) · [설치](#-설치) · [할 수 있는 것](#-할-수-있는-것) · [자주 묻는 질문](#-자주-묻는-질문)

</div>

---

## 🪟 윈도우 프로그램 (3.0.0, 이 브랜치)

브라우저 없이 설치해서 쓰는 **도트메이커 프로그램**입니다. 맥 앱([dotmaker-mac](https://github.com/YSoung99/dotmaker-mac))과 같은 기능을 씁니다.

- **원본 보존 방식** — 원본 픽셀을 결과 격자 칸마다 그대로 평균 내서 선 굵기와 명암을 살립니다. 결과 크기 100×100 ~ 200×200(10px 단위).
- **바깥 외곽선 1픽셀 검정 · 경계 섞인 색 정리** — 체크박스로 켜고 끕니다.
- **JEV 부위별 진단 / 섞인 색 판정** — LLM Gateway 판정 모델이 선 굵기·머리색·투명 테두리·외곽선·섞인 색을 원본과 비교해 후보를 고르고, 항목마다 직접 고른 뒤 **선택 적용**합니다. API 키는 윈도우 암호화 저장소에 보관합니다.
- 배경 분리 AI(anime-seg)는 처음 쓸 때 한 번 받습니다(약 168MB, 끊기면 이어받기).

**설치:** [Releases](https://github.com/YSoung99/dotmaker/releases)에서 `DotMaker-3.0.0-win-x64.exe`를 받아 실행하세요. 개발자 서명이 없어서 "Windows의 PC 보호" 창이 뜨면 **추가 정보 → 실행**을 누르면 됩니다.

**소스에서 만들기:** `npm install` 뒤 `npm start`(실행) 또는 `npm run dist:win`(설치 파일).

## ✨ 특징

- **설치 없이 바로** — HTML 파일 하나라서 더블클릭하면 브라우저에서 열려요.
- **원본 색 그대로** — 원본 색을 살리면서 색 수만 줄이고, 선은 1픽셀로 깔끔하게 정리해요.
- **그림이 밖으로 안 나가요** — 배경 지우기·선 찾기 AI가 내 컴퓨터 브라우저 안에서 돌아가요.
- **필요하면 클라우드 AI도** — PixelLab · Gemini · OpenAI 키가 있으면 AI로 다시 그리기·다듬기.

## 📥 설치

### 방법 1. 파일만 받아서 쓰기 (가장 쉬움)

1. [**릴리스 페이지**](https://github.com/YSoung99/dotmaker/releases/latest)에서 `dotmaker-…-web.zip`을 받아요.
2. 압축을 풀고 `도트메이커.html`을 **크롬이나 엣지**로 열면 끝!

### 방법 2. 명령 한 줄로 설치 (바로가기까지 만들어 줘요)

**맥 · 리눅스** — 터미널에 붙여 넣기

```bash
curl -fsSL https://raw.githubusercontent.com/YSoung99/dotmaker/main/install.sh | bash
```

**윈도우** — PowerShell에 붙여 넣기

```powershell
irm https://raw.githubusercontent.com/YSoung99/dotmaker/main/install.ps1 | iex
```

설치가 끝나면 바로 열려요. 다음부터는 이렇게 열면 돼요.

| | 여는 방법 |
|---|---|
| 맥 | 응용 프로그램 폴더(`~/Applications`)의 '도트메이커', 또는 터미널에서 `dotmaker` |
| 리눅스 | 앱 목록의 '도트메이커', 또는 터미널에서 `dotmaker` |
| 윈도우 | 시작 메뉴·바탕 화면의 '도트메이커' |

같은 명령을 다시 실행하면 최신판으로 바뀌어요.

<details>
<summary>지우는 방법 · 설치 위치</summary>

- 맥·리눅스: `curl -fsSL https://raw.githubusercontent.com/YSoung99/dotmaker/main/install.sh | bash -s -- --uninstall`
- 윈도우: `$env:DOTMAKER_UNINSTALL=1; irm https://raw.githubusercontent.com/YSoung99/dotmaker/main/install.ps1 | iex`

설치 위치: 맥·리눅스 `~/.local/share/dotmaker/`, 윈도우 `%LOCALAPPDATA%\DotMaker\`
</details>

## 🖼️ 할 수 있는 것

<img src="docs/screenshot.png" alt="도트메이커 도트화 화면" width="100%">

| 탭 | 하는 일 |
|---|---|
| **도트화** | 결과 크기(100~200)와 방식을 골라 도트 그림으로 바꿔요. 기본은 '원본 보존'. |
| **AI 보정** (선택) | PixelLab · Google Gemini · OpenAI로 결과를 다시 그려요. |
| **설명서** | 자세한 사용법과 AI 파일 직접 넣기. |

### 🤖 AI 기능 알아두기

- **배경 분리 · 선 추출 AI**는 브라우저 안에서 돌아가요. 처음 쓸 때 AI 파일(약 290MB)을 한 번 받아 브라우저에 저장해요.
- **AI 보정**은 각 서비스의 API 키가 필요하고, 사용료는 그 서비스에 내요.
  - 키는 그 브라우저에만 저장되고, 해당 서비스 주소로만 보내져요.
  - 보정을 실행하면 그 그림이 해당 서비스로 전송돼요.

## ❓ 자주 묻는 질문

<details>
<summary>파일을 열었더니 글자만 잔뜩 나와요</summary>

텍스트 편집기로 열린 거예요. 파일을 오른쪽 클릭 → **연결 프로그램** → 크롬 또는 엣지를 고르세요.
</details>

<details>
<summary>압축 파일 안에서 바로 열면 안 되나요?</summary>

압축을 먼저 풀어 주세요. 압축 프로그램 안에서 열면 브라우저가 파일을 제대로 못 읽을 수 있어요.
</details>

<details>
<summary>인터넷이 안 되는 PC에서도 AI를 쓸 수 있나요?</summary>

네. 앱의 **설명서** 탭 표에 있는 주소에서 AI 파일 5개를 다른 PC로 받아 와서 **AI 파일 불러오기…**로 넣으면 돼요.
</details>

## 🛠️ 직접 빌드하기

Node.js 18 이상이 있으면 돼요.

```bash
node tools/build.mjs   # src/ → dist/도트메이커.html
```

## 📄 라이선스

[MIT](LICENSE). 앱이 실행 중에 받아 쓰는 AI 파일은 각자의 라이선스를 따라요.

- 배경 분리: [skytnt/anime-seg](https://huggingface.co/skytnt/anime-seg) (Apache-2.0)
- 선 추출: [p1atdev/MangaLineExtraction-hf](https://huggingface.co/p1atdev/MangaLineExtraction-hf) (MIT) — `src/lines-graph.onnx`는 이 모델의 구조를 ONNX로 옮긴 것
- 실행 도구: [onnxruntime-web](https://github.com/microsoft/onnxruntime) (MIT)

README의 예시 고양이 그림은 이 저장소용으로 새로 그린 것이에요.
