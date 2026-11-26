//go:build js && wasm

// 도트메이커 작업자용 imago v0.1.0 브리지(GOOS=js GOARCH=wasm).
// 비교표와 같은 순서로 부른다: NRGBA → pix.FromImage → Resize → NRGBA().
package main

import (
	"fmt"
	"image"
	"syscall/js"

	"dotmaker.local/imago/contentadaptive"
	"github.com/loov/imago/pix"
	"github.com/loov/imago/scale/dpid"
	"github.com/loov/imago/scale/perceptual"
)

var methods = map[string]func(*pix.Image, int, int) (*pix.Image, error){
	"dpid":     func(m *pix.Image, w, h int) (*pix.Image, error) { return dpid.Resize(m, w, h, 0.5) },
	"ssim":     perceptual.Resize,
	"adaptive": contentadaptive.Resize,
}

// resize(method, w, h, bytes, toW, toH) → Uint8Array(toW*toH*4).
func resize(method string, w, h int, bytes js.Value, toW, toH int) (out js.Value, err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("imago: %v", r)
		}
	}()
	run, ok := methods[method]
	if !ok {
		return js.Null(), fmt.Errorf("imago: 모르는 방식 %q", method)
	}
	if w <= 0 || h <= 0 || bytes.Get("length").Int() != w*h*4 {
		return js.Null(), fmt.Errorf("imago: 입력 크기가 %dx%d RGBA와 맞지 않습니다", w, h)
	}
	source := image.NewNRGBA(image.Rect(0, 0, w, h))
	js.CopyBytesToGo(source.Pix, bytes)
	resized, err := run(pix.FromImage(source), toW, toH)
	if err != nil {
		return js.Null(), err
	}
	result := resized.NRGBA()
	out = js.Global().Get("Uint8Array").New(len(result.Pix))
	js.CopyBytesToJS(out, result.Pix)
	return out, nil
}

func main() {
	js.Global().Set("__imagoResize", js.FuncOf(func(_ js.Value, args []js.Value) any {
		out, err := resize(args[0].String(), args[1].Int(), args[2].Int(), args[3], args[4].Int(), args[5].Int())
		if err != nil {
			return map[string]any{"error": err.Error()}
		}
		return map[string]any{"bytes": out}
	}))
	select {}
}
