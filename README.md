# 도트메이커

캐릭터 그림을 도트(픽셀) 그림으로 바꿔 주는 앱입니다. HTML 파일 하나로 돌아가서 **윈도우·맥·리눅스** 어디서나 브라우저(크롬·엣지 권장)로 엽니다.

## 설치

**맥·리눅스** — 터미널에 붙여 넣기

```bash
curl -fsSL https://raw.githubusercontent.com/YSoung99/dotmaker/main/install.sh | bash
```

**윈도우** — PowerShell에 붙여 넣기

```powershell
irm https://raw.githubusercontent.com/YSoung99/dotmaker/main/install.ps1 | iex
```

설치가 끝나면 바로 열립니다. 다음부터는

| | 여는 방법 |
|---|---|
| 맥 | 응용 프로그램 폴더(`~/Applications`)의 '도트메이커', 또는 터미널에서 `dotmaker` |
| 리눅스 | 앱 목록의 '도트메이커', 또는 터미널에서 `dotmaker` |
| 윈도우 | 시작 메뉴·바탕 화면의 '도트메이커' |

같은 명령을 다시 실행하면 최신판으로 바뀝니다.

<details>
<summary>지우기 · 설치 없이 쓰기</summary>

- 맥·리눅스: `curl -fsSL https://raw.githubusercontent.com/YSoung99/dotmaker/main/install.sh | bash -s -- --uninstall`
- 윈도우: `$env:DOTMAKER_UNINSTALL=1; irm https://raw.githubusercontent.com/YSoung99/dotmaker/main/install.ps1 | iex`
- 설치 없이: [`dist/도트메이커.html`](dist/도트메이커.html)을 내려받아 브라우저로 열어도 똑같이 돌아갑니다.

설치 위치: 맥·리눅스 `~/.local/share/dotmaker/`, 윈도우 `%LOCALAPPDATA%\DotMaker\`
</details>

## 할 수 있는 것

- **축소 · 도트화** — 원하는 가로·세로로 줄이고 색 수·외곽선·투명도를 골라 도트 그림으로. 기본은 원본 색을 살리는 방식.
- **배경 분리 AI · 선 추출 AI** — 브라우저 안에서 돌아갑니다(그림이 밖으로 나가지 않음). 처음 쓸 때 AI 파일(약 290MB)을 한 번 받아 브라우저에 저장합니다. 인터넷이 안 되는 PC는 설명서 탭의 주소에서 직접 받아 넣을 수 있어요.
- **AI 보정 · PixelLab 작업실** (선택) — PixelLab, Google Gemini, OpenAI의 API 키가 있으면 다시 그리기·다듬기·8방향·애니메이션 등을 씁니다. 사용료는 각 서비스에 냅니다.
  - 키는 그 브라우저에만 저장되고 해당 서비스 주소로만 보내집니다.
  - 보정을 실행하면 그 그림이 해당 서비스로 전송됩니다.

자세한 사용법은 앱의 **설명서** 탭에 있습니다.

## 직접 빌드하기

Node.js 18 이상이 있으면 됩니다.

```bash
node tools/build.mjs   # src/ → dist/도트메이커.html
```

## 라이선스

[MIT](LICENSE). 앱이 실행 중에 받아 쓰는 AI 파일은 각자의 라이선스를 따릅니다.

- 배경 분리: [skytnt/anime-seg](https://huggingface.co/skytnt/anime-seg) (Apache-2.0)
- 선 추출: [p1atdev/MangaLineExtraction-hf](https://huggingface.co/p1atdev/MangaLineExtraction-hf) (MIT) — `src/lines-graph.onnx`는 이 모델의 구조를 ONNX로 옮긴 것
- 실행 도구: [onnxruntime-web](https://github.com/microsoft/onnxruntime) (MIT)
