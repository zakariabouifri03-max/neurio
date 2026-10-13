extends RefCounted
## Builds the block texture atlas at runtime (no image files needed).
## Each tile is TILE x TILE pixels; tiles are laid out COLS x ROWS.

const TILE := 32
const COLS := 8
const ROWS := 4


static func image_size() -> Vector2i:
	return Vector2i(COLS * TILE, ROWS * TILE)


static func build_image() -> Image:
	var img := Image.create(COLS * TILE, ROWS * TILE, false, Image.FORMAT_RGBA8)
	for t in range(18):
		var col: int = t % COLS
		var row: int = t / COLS
		_paint_tile(img, col * TILE, row * TILE, t)
	img.generate_mipmaps()
	return img


static func _hash(x: int, y: int, s: int) -> float:
	var h: int = (x * 374761393 + y * 668265263 + s * 1442695041) & 0x7fffffff
	h = ((h ^ (h >> 13)) * 1274126177) & 0x7fffffff
	h = h ^ (h >> 16)
	return float(h & 0xffff) / 65535.0


static func _paint_tile(img: Image, ox: int, oy: int, t: int) -> void:
	for py in TILE:
		for px in TILE:
			var n: float = _hash(px, py, t)
			var n2: float = _hash(px / 2, py / 2, t + 50)
			var c: Color = _pixel(t, px, py, n, n2)
			img.set_pixel(ox + px, oy + py, c)


static func _shade(c: Color, n: float, amount: float) -> Color:
	var k: float = 1.0 + (n - 0.5) * amount
	return Color(c.r * k, c.g * k, c.b * k, c.a)


static func _pixel(t: int, px: int, py: int, n: float, n2: float) -> Color:
	match t:
		0: # grass top
			var c := Color(0.36, 0.62, 0.24)
			if n > 0.82:
				c = Color(0.46, 0.74, 0.32)
			elif n < 0.12:
				c = Color(0.27, 0.5, 0.19)
			return _shade(c, n2, 0.12)
		1: # grass side: green cap with jagged edge over dirt
			var edge: int = 8 + int(n2 * 3.0)
			if py < edge:
				return _shade(Color(0.36, 0.62, 0.24), n, 0.14)
			return _shade(Color(0.5, 0.35, 0.22), n, 0.2)
		2: # dirt
			return _shade(Color(0.5, 0.35, 0.22), n, 0.25)
		3: # stone with cracks
			var c3 := Color(0.5, 0.5, 0.53)
			if n2 > 0.86:
				c3 = Color(0.36, 0.36, 0.38)
			return _shade(c3, n, 0.18)
		4: # sand
			return _shade(Color(0.88, 0.82, 0.6), n, 0.1)
		5: # water (translucent)
			var wave: float = sin(px * 0.55 + py * 0.25) * 0.5 + 0.5
			var c5 := Color(0.22, 0.48, 0.88, 0.72).lerp(Color(0.4, 0.66, 0.98, 0.8), wave)
			return _shade(c5, n, 0.08)
		6: # bark
			var stripe: float = sin(px * 1.3 + n2 * 2.0)
			var c6 := Color(0.42, 0.3, 0.18)
			if stripe > 0.5:
				c6 = Color(0.32, 0.22, 0.13)
			return _shade(c6, n, 0.2)
		7: # log top with rings
			var d: float = Vector2(px - 15.5, py - 15.5).length()
			var c7 := Color(0.72, 0.56, 0.36)
			if fmod(d, 3.2) < 1.1:
				c7 = Color(0.52, 0.38, 0.22)
			return _shade(c7, n, 0.1)
		8: # leaves with holes
			var c8 := Color(0.2, 0.5, 0.2)
			if n > 0.82:
				c8 = Color(0.1, 0.3, 0.1)
			elif n < 0.1:
				c8 = Color(0.3, 0.62, 0.3)
			return c8
		9: # planks
			var row: int = py / 8
			var c9 := Color(0.78, 0.6, 0.38)
			if py % 8 == 0:
				c9 = Color(0.5, 0.35, 0.2)
			elif (px + row * 8) % 16 == 0:
				c9 = Color(0.6, 0.45, 0.27)
			return _shade(c9, n, 0.08)
		10: # brick
			var brow: int = py / 8
			var off: int = (brow % 2) * 8
			if py % 8 == 7 or (px + off) % 16 == 15:
				return _shade(Color(0.8, 0.78, 0.72), n, 0.06)
			return _shade(Color(0.62, 0.25, 0.2), n, 0.2)
		11: # concrete
			var c11 := Color(0.68, 0.68, 0.66)
			if n2 > 0.93:
				c11 = Color(0.55, 0.55, 0.54)
			return _shade(c11, n, 0.08)
		12: # glass pane with frame
			if px < 2 or py < 2 or px > 29 or py > 29:
				return Color(0.85, 0.9, 0.95, 1.0)
			if abs(px - py) < 3:
				return Color(0.82, 0.95, 1.0, 0.9)
			return Color(0.6, 0.85, 0.95, 0.85)
		13: # road gravel
			var c13 := Color(0.32, 0.32, 0.34)
			if n > 0.9:
				c13 = Color(0.5, 0.5, 0.5)
			return _shade(c13, n2, 0.2)
		14: # crate
			var c14 := Color(0.66, 0.5, 0.28)
			if px < 3 or py < 3 or px > 28 or py > 28:
				c14 = Color(0.45, 0.3, 0.15)
			elif abs(px - py) < 2 or abs(px + py - 31) < 2:
				c14 = Color(0.5, 0.36, 0.2)
			return _shade(c14, n, 0.1)
		15: # sandbag
			var c15 := Color(0.78, 0.7, 0.45)
			if py % 8 == 0:
				c15 = Color(0.6, 0.52, 0.3)
			return _shade(c15, n, 0.14)
		16: # roof shingles
			var rrow: int = py / 6
			var roff: int = (rrow % 2) * 5
			if py % 6 == 0 or (px + roff) % 10 == 0:
				return Color(0.36, 0.1, 0.08)
			return _shade(Color(0.6, 0.22, 0.16), n, 0.15)
		17: # metal panel with rivets
			var c17 := Color(0.5, 0.55, 0.6)
			if (px >= 3 and px <= 4) or (px >= 27 and px <= 28):
				if (py >= 3 and py <= 4) or (py >= 27 and py <= 28):
					c17 = Color(0.8, 0.82, 0.85)
			if py == 15:
				c17 = Color(0.38, 0.42, 0.46)
			return _shade(c17, n, 0.06)
		18: # cobblestone
			var lx: int = px % 8
			var ly: int = py % 8
			var dd: float = Vector2(lx - 3.5, ly - 3.5).length()
			if dd < 3.0:
				return _shade(Color(0.62, 0.6, 0.58), n, 0.15)
			return Color(0.35, 0.34, 0.33)
	return Color.MAGENTA
