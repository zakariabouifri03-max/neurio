import zlib, struct, math

def make_png(width, height, draw_func):
    def chunk(tag, data):
        return struct.pack('!I', len(data)) + tag + data + struct.pack('!I', zlib.crc32(tag + data) & 0xffffffff)
    raw = bytearray()
    for y in range(height):
        raw.append(0)
        for x in range(width):
            r, g, b, a = draw_func(x, y, width, height)
            raw.extend([int(r), int(g), int(b), int(a)])
    ihdr = struct.pack('!IIBBBBB', width, height, 8, 6, 0, 0, 0)
    idat = zlib.compress(bytes(raw), 9)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', idat) + chunk(b'IEND', b'')

def render_icon_pixel(x, y, w, h):
    # Normalized coords [0, 1]
    nx = (x + 0.5) / w
    ny = (y + 0.5) / h
    
    # Rounded rectangle background
    corner_r = 0.22
    dx = max(abs(nx - 0.5) - (0.5 - corner_r), 0)
    dy = max(abs(ny - 0.5) - (0.5 - corner_r), 0)
    dist_corner = math.sqrt(dx*dx + dy*dy)
    if dist_corner > corner_r:
        return (0, 0, 0, 0)
    
    # Gradient background: deep indigo / violet (#1e1b4b -> #4338ca)
    bg_t = (nx + ny) / 2.0
    r_bg = int(25 + bg_t * 40)
    g_bg = int(20 + bg_t * 30)
    b_bg = int(60 + bg_t * 130)

    # Magnifying glass circle center at (0.44, 0.44)
    mcx, mcy = 0.44, 0.44
    mr = 0.25
    dist_m = math.sqrt((nx - mcx)**2 + (ny - mcy)**2)

    # Handle: line from (0.60, 0.60) to (0.84, 0.84)
    # Distance from line segment
    hx1, hy1 = 0.58, 0.58
    hx2, hy2 = 0.85, 0.85
    # project onto line
    l2 = (hx2 - hx1)**2 + (hy2 - hy1)**2
    t = max(0.0, min(1.0, ((nx - hx1)*(hx2 - hx1) + (ny - hy1)*(hy2 - hy1)) / l2))
    proj_x = hx1 + t * (hx2 - hx1)
    proj_y = hy1 + t * (hy2 - hy1)
    dist_handle = math.sqrt((nx - proj_x)**2 + (ny - proj_y)**2)
    handle_width = 0.055

    # Check handle
    if dist_handle <= handle_width and t >= 0.05:
        # Gold handle
        return (245, 158, 11, 255)

    # Magnifying rim
    rim_w = 0.05
    if abs(dist_m - mr) <= rim_w:
        # Amber gold ring
        return (251, 191, 36, 255)
    
    # Inside glass
    if dist_m < mr - rim_w:
        # Inner lens glow + Star in center
        # Check star shape at (mcx, mcy)
        sx = nx - mcx
        sy = ny - mcy
        dist_s = math.sqrt(sx*sx + sy*sy)
        angle = math.atan2(sy, sx)
        # 5-pointed star equation
        points = 5
        star_r = 0.12 * (0.65 + 0.35 * math.cos(points * angle))
        if dist_s < star_r:
            # Bright yellow-orange winning star
            return (254, 240, 138, 255)
        # Glass tint
        return (49, 46, 129, 255)

    # Subtle border rim
    if dist_corner > corner_r - 0.03:
        return (99, 102, 241, 255)

    return (r_bg, g_bg, b_bg, 255)

for size in [16, 32, 48, 128]:
    data = make_png(size, size, render_icon_pixel)
    path = f"extension/icons/icon{size}.png"
    with open(path, "wb") as f:
        f.write(data)
    print(f"Created {path} ({size}x{size})")

