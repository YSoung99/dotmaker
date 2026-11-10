<div align="center">

# 🎨 도트메이커

**캐릭터 그림을 넣으면 원본을 살린 도트(픽셀) 그림으로 바꿔 주는 프로그램**

<img src="docs/before-after.png" alt="원본 그림과 도트메이커 결과 비교" width="760">

</div>

---

## 💾 받기

| 운영체제 | 받기 | 설치 방법 |
|---|---|---|
| **윈도우** 10/11 (64비트) | [DotMaker-3.0.0-win-x64.exe](https://github.com/YSoung99/dotmaker/releases/download/v3.0.0-windows/DotMaker-3.0.0-win-x64.exe) | 받은 파일을 실행 → 설치 위치 고르고 **설치**. "Windows의 PC 보호" 창이 뜨면 **추가 정보 → 실행** |
| **맥** (Apple Silicon, macOS 14 이상) | [DotMaker-mac-3.0.0-arm64.zip](https://github.com/YSoung99/dotmaker-mac/releases/download/v3.0.0/DotMaker-mac-3.0.0-arm64.zip) | 압축을 풀어 앱을 **응용 프로그램** 폴더로 옮긴 뒤, 터미널에서 아래 명령을 한 번 실행 |

```sh
xattr -dr com.apple.quarantine "/Applications/도트메이커 JEV 부위별 진단 시험.app"
```

- **원본 보존** 방식(결과 크기 100×100 ~ 200×200), 바깥 외곽선 1픽셀 · 경계 섞인 색 정리, **JEV 부위별 진단 · 섞인 색 판정**(직접 고르기)을 씁니다.
- JEV를 쓰려면 프로그램의 **JEV 설정**에 [LLM Gateway](https://llmgateway.io) API 키를 넣으세요(판정할 때 그림이 LLM Gateway로 전송되고 요금은 내 계정에 청구).

## 🧩 소스

- 윈도우 프로그램(Electron): 이 저장소의 [`desktop-app` 브랜치](https://github.com/YSoung99/dotmaker/tree/desktop-app)
- 맥 앱(Swift): [YSoung99/dotmaker-mac](https://github.com/YSoung99/dotmaker-mac)

> 브라우저로 여는 웹 버전(2.9.0)은 2026-11-10에 배포를 끝냈습니다. 설치형 프로그램을 써 주세요.

## 📄 라이선스

MIT
