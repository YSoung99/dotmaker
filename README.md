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

## 💾 설치형 프로그램 (추천 · 3.0.0)

브라우저 없이 설치해서 쓰는 도트메이커입니다. **원본 보존** 방식(결과 크기 100×100 ~ 200×200), 바깥 외곽선 1픽셀 · 경계 섞인 색 정리, **JEV 부위별 진단 · 섞인 색 판정**(직접 고르기)을 씁니다.

| 운영체제 | 받기 | 설치 방법 |
|---|---|---|
| **윈도우** 10/11 (64비트) | [DotMaker-3.0.0-win-x64.exe](https://github.com/YSoung99/dotmaker/releases/download/v3.0.0-windows/DotMaker-3.0.0-win-x64.exe) | 받은 파일을 실행 → 설치 위치 고르고 **설치**. "Windows의 PC 보호" 창이 뜨면 **추가 정보 → 실행** |
| **맥** (Apple Silicon, macOS 14 이상) | [DotMaker-mac-3.0.0-arm64.zip](https://github.com/YSoung99/dotmaker-mac/releases/download/v3.0.0/DotMaker-mac-3.0.0-arm64.zip) | 압축을 풀어 앱을 **응용 프로그램** 폴더로 옮긴 뒤, 터미널에서 아래 명령을 한 번 실행 |

```sh
xattr -dr com.apple.quarantine "/Applications/도트메이커 JEV 부위별 진단 시험.app"
```

- 윈도우 프로그램 소스: 이 저장소의 [`desktop-app` 브랜치](https://github.com/YSoung99/dotmaker/tree/desktop-app) · 맥 앱 소스: [YSoung99/dotmaker-mac](https://github.com/YSoung99/dotmaker-mac)
- JEV를 쓰려면 프로그램의 **JEV 설정**에 [LLM Gateway](https://llmgateway.io) API 키를 넣으세요(판정할 때 그림이 LLM Gateway로 전송되고 요금은 내 계정에 청구).
- 색 배경 그림의 배경 분리 AI는 윈도우판은 처음 한 번 받고(약 168MB), 맥 앱에는 들어 있습니다.

> 아래는 브라우저로 여는 **웹 버전(2.9.0)** 안내입니다.

---

## ✨ 특징

- **설치 없이 바로** — HTML 파일 하나라서 더블클릭하면 브라우저에서 열려요.
- **원본 색 그대로** — 원본 색을 살리면서 색 수만 줄이고, 선은 1픽셀로 깔끔하게 정리해요.
- **그림이 밖으로 안 나가요** — 배경 지우기·선 찾기 AI가 내 컴퓨터 브라우저 안에서 돌아가요.
- **필요하면 클라우드 AI도** — PixelLab · Gemini · OpenAI 키가 있으면 다시 그리기, 8방향, 애니메이션까지.

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
| **축소** | 배경을 지우고 원하는 가로·세로(예: 100×100)로 줄여요. |
| **도트화** | 색 수·외곽선·색 정리를 골라 도트 그림으로 바꿔요. 기본은 '원본 색 살림'. |
| **AI 보정** (선택) | PixelLab · Google Gemini · OpenAI로 결과를 다시 그려요. |
| **PixelLab 작업실** (선택) | 다듬기 · 글로 고치기 · 부분 다시 그리기 · 8방향 · 애니메이션 · 옷 입히기. |
| **설명서** | 자세한 사용법과 AI 파일 직접 넣기. |

### 🤖 AI 기능 알아두기

- **배경 분리 · 선 추출 AI**는 브라우저 안에서 돌아가요. 처음 쓸 때 AI 파일(약 290MB)을 한 번 받아 브라우저에 저장해요.
- **AI 보정 · PixelLab 작업실**은 각 서비스의 API 키가 필요하고, 사용료는 그 서비스에 내요.
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
