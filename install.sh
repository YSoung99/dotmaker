#!/usr/bin/env bash
# 도트메이커 설치(맥·리눅스): curl -fsSL https://raw.githubusercontent.com/YSoung99/dotmaker/main/install.sh | bash
# 다시 실행하면 최신판으로 바뀐다. 지우기: ... | bash -s -- --uninstall
set -euo pipefail

URL="${DOTMAKER_URL:-https://raw.githubusercontent.com/YSoung99/dotmaker/main/dist/%EB%8F%84%ED%8A%B8%EB%A9%94%EC%9D%B4%EC%BB%A4.html}"
HOME_DIR="${DOTMAKER_HOME:-$HOME/.local/share/dotmaker}"
BIN_DIR="${DOTMAKER_BIN:-$HOME/.local/bin}"
PAGE="$HOME_DIR/dotmaker.html"
OS="$(uname -s)"
MAC_APP="$HOME/Applications/도트메이커.app"
LINUX_ENTRY="$HOME/.local/share/applications/dotmaker.desktop"

if [ "${1:-}" = "--uninstall" ]; then
  rm -rf "$HOME_DIR" "$BIN_DIR/dotmaker" "$MAC_APP" "$LINUX_ENTRY"
  echo "도트메이커를 지웠습니다. (브라우저에 저장된 AI 파일은 앱의 설명서 탭에서 지울 수 있어요)"
  exit 0
fi

mkdir -p "$HOME_DIR" "$BIN_DIR"
echo "도트메이커 받는 중..."
curl -fsSL "$URL" -o "$PAGE.part"
grep -q '<title>도트메이커</title>' "$PAGE.part" || { rm -f "$PAGE.part"; echo "받은 파일이 도트메이커가 아닙니다. 잠시 뒤 다시 해 주세요." >&2; exit 1; }
mv "$PAGE.part" "$PAGE"

case "$OS" in
  Darwin) OPEN="open" ;;
  *) OPEN="xdg-open" ;;
esac

# 터미널 명령 'dotmaker'
cat > "$BIN_DIR/dotmaker" <<EOF
#!/usr/bin/env bash
exec $OPEN "$PAGE"
EOF
chmod +x "$BIN_DIR/dotmaker"

# 앱 목록에 바로가기
if [ "$OS" = "Darwin" ]; then
  mkdir -p "$MAC_APP/Contents/MacOS"
  cat > "$MAC_APP/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>도트메이커</string>
  <key>CFBundleIdentifier</key><string>local.dotmaker.launcher</string>
  <key>CFBundleExecutable</key><string>dotmaker</string>
  <key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>
EOF
  cp "$BIN_DIR/dotmaker" "$MAC_APP/Contents/MacOS/dotmaker"
elif [ -d "$HOME/.local/share" ]; then
  mkdir -p "$(dirname "$LINUX_ENTRY")"
  cat > "$LINUX_ENTRY" <<EOF
[Desktop Entry]
Type=Application
Name=도트메이커
Comment=캐릭터 그림을 도트 그림으로
Exec=xdg-open "$PAGE"
Terminal=false
Categories=Graphics;
EOF
fi

echo "설치 완료: $PAGE"
case ":$PATH:" in
  *":$BIN_DIR:"*) echo "다음부터는 터미널에서 'dotmaker'를 입력하면 열립니다." ;;
  *) echo "다음부터는 '$BIN_DIR/dotmaker'로 열 수 있습니다. ('dotmaker'만으로 열려면 $BIN_DIR을 PATH에 넣어 주세요)" ;;
esac
[ "$OS" = "Darwin" ] && echo "응용 프로그램 폴더(~/Applications)의 '도트메이커'로도 열 수 있어요."
[ -z "${DOTMAKER_NO_OPEN:-}" ] && "$BIN_DIR/dotmaker" >/dev/null 2>&1 || true
