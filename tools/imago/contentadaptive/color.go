// imago v0.1.0 chroma(MIT, tools/imago/LICENSE-imago)에서 내용 적응형 축소가 쓰는 부분만 옮겼다.
// 바뀐 점은 math.Pow 대신 portablePow를 쓰는 것뿐이다(portable_math.go 참고).
package contentadaptive

import "math"

// RGB is linear light in sRGB primaries.
type RGB struct{ R, G, B float64 }

// XYZ is CIE 1931 XYZ relative to D65.
type XYZ struct{ X, Y, Z float64 }

// D65 reference white in XYZ.
const d65X, d65Y, d65Z = 0.95047, 1.0, 1.08883

// mat is a row-major 3x3 matrix.
type mat [3][3]float64

func (m mat) mul(a, b, c float64) (float64, float64, float64) {
	return m[0][0]*a + m[0][1]*b + m[0][2]*c,
		m[1][0]*a + m[1][1]*b + m[1][2]*c,
		m[2][0]*a + m[2][1]*b + m[2][2]*c
}

// inv returns the inverse; used so round-trips are exact to float precision
// rather than limited by published truncated inverses.
func (m mat) inv() mat {
	c := mat{
		{m[1][1]*m[2][2] - m[1][2]*m[2][1], m[0][2]*m[2][1] - m[0][1]*m[2][2], m[0][1]*m[1][2] - m[0][2]*m[1][1]},
		{m[1][2]*m[2][0] - m[1][0]*m[2][2], m[0][0]*m[2][2] - m[0][2]*m[2][0], m[0][2]*m[1][0] - m[0][0]*m[1][2]},
		{m[1][0]*m[2][1] - m[1][1]*m[2][0], m[0][1]*m[2][0] - m[0][0]*m[2][1], m[0][0]*m[1][1] - m[0][1]*m[1][0]},
	}
	det := m[0][0]*c[0][0] + m[0][1]*c[1][0] + m[0][2]*c[2][0]
	for i := range c {
		for j := range c[i] {
			c[i][j] /= det
		}
	}
	return c
}

var (
	rgbToXYZ = mat{
		{0.4124564, 0.3575761, 0.1804375},
		{0.2126729, 0.7151522, 0.0721750},
		{0.0193339, 0.1191920, 0.9503041},
	}
	xyzToRGB = rgbToXYZ.inv()
)

// XYZ converts linear RGB to XYZ.
func (c RGB) XYZ() XYZ {
	x, y, z := rgbToXYZ.mul(c.R, c.G, c.B)
	return XYZ{x, y, z}
}

// RGBFromXYZ converts XYZ to linear RGB.
func RGBFromXYZ(c XYZ) RGB {
	r, g, b := xyzToRGB.mul(c.X, c.Y, c.Z)
	return RGB{r, g, b}
}

// SRGB is gamma-encoded sRGB with components nominally in 0..1.
type SRGB struct{ R, G, B float64 }

// ToLinear applies the inverse sRGB transfer function to one component.
func ToLinear(v float64) float64 {
	if v <= 0.04045 {
		return v / 12.92
	}
	return portablePow((v+0.055)/1.055, 2.4)
}

// ToSRGB applies the sRGB transfer function to one linear component.
func ToSRGB(v float64) float64 {
	if v <= 0.0031308 {
		return v * 12.92
	}
	return 1.055*portablePow(v, 1/2.4) - 0.055
}

// RGB decodes to linear light.
func (c SRGB) RGB() RGB { return RGB{ToLinear(c.R), ToLinear(c.G), ToLinear(c.B)} }

// SRGBFromRGB encodes linear light.
func SRGBFromRGB(c RGB) SRGB { return SRGB{ToSRGB(c.R), ToSRGB(c.G), ToSRGB(c.B)} }

// Clamp limits each component to 0..1.
func (c SRGB) Clamp() SRGB {
	return SRGB{min(max(c.R, 0), 1), min(max(c.G, 0), 1), min(max(c.B, 0), 1)}
}

// Lab is CIELAB relative to D65, L in 0..100.
type Lab struct{ L, A, B float64 }

const (
	labEps   = 216.0 / 24389 // (6/29)^3
	labKappa = 24389.0 / 27  // (29/3)^3
)

func labF(t float64) float64 {
	if t > labEps {
		return math.Cbrt(t)
	}
	return (labKappa*t + 16) / 116
}

func labFInv(t float64) float64 {
	if t3 := t * t * t; t3 > labEps {
		return t3
	}
	return (116*t - 16) / labKappa
}

// LabFromXYZ converts XYZ to Lab.
func LabFromXYZ(c XYZ) Lab {
	fx, fy, fz := labF(c.X/d65X), labF(c.Y/d65Y), labF(c.Z/d65Z)
	return Lab{L: 116*fy - 16, A: 500 * (fx - fy), B: 200 * (fy - fz)}
}

// XYZ converts Lab to XYZ.
func (c Lab) XYZ() XYZ {
	fy := (c.L + 16) / 116
	fx, fz := fy+c.A/500, fy-c.B/200
	return XYZ{labFInv(fx) * d65X, labFInv(fy) * d65Y, labFInv(fz) * d65Z}
}
