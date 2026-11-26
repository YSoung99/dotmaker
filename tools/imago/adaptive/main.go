// 설치판용 imago v0.1.0 contentadaptive 네이티브 헬퍼.
// 사용법: dotmaker-adaptive sourceW sourceH targetW targetH < source.rgba > result.rgba
// 입력·출력은 straight(비premultiplied) RGBA 8비트, 정확히 w*h*4바이트. 오류는 stderr + exit 1.
package main

import (
	"bufio"
	"fmt"
	"image"
	"io"
	"os"
	"strconv"

	"github.com/loov/imago/pix"
	"github.com/loov/imago/scale/contentadaptive"
)

const maxSide = 16384

func run() error {
	if len(os.Args) != 5 {
		return fmt.Errorf("인자는 sourceW sourceH targetW targetH 네 개여야 합니다")
	}
	var size [4]int
	for i, arg := range os.Args[1:] {
		n, err := strconv.Atoi(arg)
		if err != nil || n <= 0 || n > maxSide {
			return fmt.Errorf("크기 %q는 1~%d 정수여야 합니다", arg, maxSide)
		}
		size[i] = n
	}
	w, h, toW, toH := size[0], size[1], size[2], size[3]
	if toW > w || toH > h {
		return fmt.Errorf("목표 크기 %dx%d가 원본 %dx%d보다 큽니다", toW, toH, w, h)
	}
	source := image.NewNRGBA(image.Rect(0, 0, w, h))
	if _, err := io.ReadFull(os.Stdin, source.Pix); err != nil {
		return fmt.Errorf("입력은 정확히 %d바이트여야 합니다: %v", len(source.Pix), err)
	}
	if n, _ := os.Stdin.Read(make([]byte, 1)); n != 0 {
		return fmt.Errorf("입력이 %d바이트보다 깁니다", len(source.Pix))
	}
	resized, err := contentadaptive.Resize(pix.FromImage(source), toW, toH)
	if err != nil {
		return err
	}
	out := bufio.NewWriter(os.Stdout)
	if _, err := out.Write(resized.NRGBA().Pix); err != nil {
		return err
	}
	return out.Flush()
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "dotmaker-adaptive:", err)
		os.Exit(1)
	}
}
