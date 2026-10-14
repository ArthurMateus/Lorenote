"""Render the Lorenote app icons (PNG, stdlib only).  usage: python tools/make_icons.py"""
import struct, zlib, os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'app', 'icons')
ORANGE = (91, 91, 214); WHITE = (255, 255, 255)   # brand indigo

def png(path, size, pad=0.0, rounded=True, bg=ORANGE):
    s = size; rows = []
    r_out = s * 0.22 if rounded else 0
    def inside_round(x, y, x0, y0, x1, y1, r):
        if x < x0 or x >= x1 or y < y0 or y >= y1: return False
        cx = min(max(x, x0 + r), x1 - r - 1); cy = min(max(y, y0 + r), y1 - r - 1)
        return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
    u = s * (1 - 2 * pad) / 32.0; o = s * pad       # 32-unit design grid inside the padded area
    tiles = [(7, 7, 15, 15, 1.0), (17, 7, 25, 19, .82), (7, 17, 15, 25, .82)]
    for y in range(s):
        row = bytearray([0])
        for x in range(s):
            if rounded and not inside_round(x, y, 0, 0, s, s, r_out): row += bytes((0, 0, 0, 0)); continue
            px = (*bg, 255)
            for x0, y0, x1, y1, a in tiles:
                if inside_round(x, y, o + x0 * u, o + y0 * u, o + x1 * u, o + y1 * u, 2 * u):
                    px = (*[round(c * a + b * (1 - a)) for c, b in zip(WHITE, bg)], 255); break
            row += bytes(px)
        rows.append(bytes(row))
    raw = b''.join(rows)
    def chunk(t, d): c = struct.pack('>I', len(d)) + t + d; return c + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', s, s, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    open(os.path.join(OUT, path), 'wb').write(data); print(path, len(data))

png('icon-192.png', 192)
png('icon-512.png', 512)
png('icon-maskable-512.png', 512, pad=0.16, rounded=False)   # full-bleed, content inside the safe zone
png('apple-touch-icon.png', 180, rounded=False)               # iOS rounds it itself
png('favicon-32.png', 32)
