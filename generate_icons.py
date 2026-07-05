"""Generate placeholder PWA icons (192px and 512px) — dark rounded square with a single
accent-colored dot, standing in for a one-thumb tap point until real art replaces it."""
import struct
import zlib
import os


def png_chunk(tag, data):
    crc = zlib.crc32(tag + data) & 0xffffffff
    return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', crc)


class Canvas:
    def __init__(self, size, bg):
        self.size = size
        self.buf = [list(bg) for _ in range(size * size)]

    def _set(self, x, y, color):
        if 0 <= x < self.size and 0 <= y < self.size:
            self.buf[y * self.size + x] = list(color)

    def fill_rect(self, x, y, w, h, color, radius=0):
        for py in range(y, y + h):
            for px in range(x, x + w):
                if radius > 0:
                    dx = min(px - x, x + w - 1 - px)
                    dy = min(py - y, y + h - 1 - py)
                    if dx < radius and dy < radius:
                        if (radius - dx) ** 2 + (radius - dy) ** 2 > radius ** 2:
                            continue
                self._set(px, py, color)

    def fill_circle(self, cx, cy, r, color):
        for py in range(cy - r, cy + r + 1):
            for px in range(cx - r, cx + r + 1):
                if (px - cx) ** 2 + (py - cy) ** 2 <= r ** 2:
                    self._set(px, py, color)

    def write_png(self, path):
        raw = bytearray()
        for y in range(self.size):
            raw.append(0)  # no filter
            for x in range(self.size):
                r, g, b = self.buf[y * self.size + x]
                raw += bytes((r, g, b, 255))
        ihdr = struct.pack('>IIBBBBB', self.size, self.size, 8, 6, 0, 0, 0)
        png = b'\x89PNG\r\n\x1a\n'
        png += png_chunk(b'IHDR', ihdr)
        png += png_chunk(b'IDAT', zlib.compress(bytes(raw), 9))
        png += png_chunk(b'IEND', b'')
        with open(path, 'wb') as f:
            f.write(png)


def make_icon(size, path):
    bg = (0x11, 0x11, 0x11)
    accent = (0xe8, 0xa3, 0x3d)
    c = Canvas(size, bg)
    pad = round(size * 0.08)
    c.fill_rect(pad, pad, size - pad * 2, size - pad * 2, bg, radius=round(size * 0.18))
    c.fill_circle(size // 2, size // 2, round(size * 0.22), accent)
    c.write_png(path)


if __name__ == '__main__':
    out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'public', 'icons')
    os.makedirs(out_dir, exist_ok=True)
    make_icon(192, os.path.join(out_dir, 'icon-192.png'))
    make_icon(512, os.path.join(out_dir, 'icon-512.png'))
    print('Icons written to', out_dir)
