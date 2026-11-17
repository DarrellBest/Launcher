# Launcher icon: the launcher's own sigil (renderer/index.html .sigil) + star rune (.brand-mini .rune),
# in its palette (--void/--panel, --arcane, --arcane-bright, --gold). Drawn at 4x, downsampled.
import sys, math
from PIL import Image, ImageDraw, ImageFilter
OUT = sys.argv[1]; N = 1024; S = 4; W = N * S
VOID, PANEL = (10, 7, 18), (29, 20, 56)
ARCANE, BRIGHT, GOLD = (168, 117, 255), (201, 167, 255), (243, 201, 122)

def sq(c, a=255): return c + (a,)

# rounded-square plate with a radial purple glow
plate = Image.new('RGBA', (W, W), (0, 0, 0, 0))
mask = Image.new('L', (W, W), 0)
pad = int(W * 0.04); rad = int(W * 0.2)
ImageDraw.Draw(mask).rounded_rectangle([pad, pad, W - pad, W - pad], rad, fill=255)
bg = Image.new('RGBA', (W, W), sq(VOID))
g = Image.new('RGBA', (W, W), (0, 0, 0, 0)); gd = ImageDraw.Draw(g)
for i in range(60, 0, -1):
    r = W * 0.46 * i / 60; t = 1 - i / 60
    col = tuple(int(VOID[k] + (PANEL[k] - VOID[k]) * (0.35 + 0.65 * t)) for k in range(3))
    gd.ellipse([W/2 - r, W/2 - r, W/2 + r, W/2 + r], fill=sq(col))
bg.alpha_composite(g)
plate.paste(bg, (0, 0), mask)

# sigil geometry in a 200-unit box (same as the SVG), scaled to the plate
k = W * 0.80 / 200; ox = oy = (W - 200 * k) / 2
P = lambda x, y: (ox + x * k, oy + y * k)
def circle(d, r, w, col):
    cx, cy = P(100, 100); rr = r * k
    d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], outline=col, width=max(1, int(w * k)))
def poly(d, pts, w, col):
    q = [P(*p) for p in pts]; d.line(q + [q[0]], fill=col, width=max(1, int(w * k)), joint='curve')

def sigil(col, wmul):
    layer = Image.new('RGBA', (W, W), (0, 0, 0, 0)); d = ImageDraw.Draw(layer)
    circle(d, 96, 2.2 * wmul, col); circle(d, 74, 1.6 * wmul, col)
    poly(d, [(100, 12), (176, 150), (24, 150)], 1.8 * wmul, col)
    poly(d, [(100, 188), (24, 50), (176, 50)], 1.8 * wmul, col)
    circle(d, 40, 1.6 * wmul, col)
    return layer

# star rune (24-unit path), centred, gold
star = [(12, 2), (15, 8), (21, 9), (16.5, 13.3), (18, 22), (12, 18.6), (6, 22), (7.5, 13.3), (3, 9), (9, 8)]
def rune(fill_col, line_col, w):
    layer = Image.new('RGBA', (W, W), (0, 0, 0, 0)); d = ImageDraw.Draw(layer)
    sc = W * 0.30 / 24; cx = W / 2 - 12 * sc; cy = W / 2 - 12.2 * sc
    q = [(cx + x * sc, cy + y * sc) for x, y in star]
    d.polygon(q, fill=fill_col); d.line(q + [q[0]], fill=line_col, width=int(w * sc), joint='curve')
    return layer

out = plate.copy()
glow = sigil(sq(ARCANE), 3.0).filter(ImageFilter.GaussianBlur(W * 0.018))
out.alpha_composite(glow); out.alpha_composite(glow)
out.alpha_composite(sigil(sq(BRIGHT), 1.0))
rg = rune(sq(GOLD, 255), sq(GOLD), 1.2).filter(ImageFilter.GaussianBlur(W * 0.02))
out.alpha_composite(rg)
out.alpha_composite(rune(sq((255, 226, 160)), sq(GOLD), 0.9))
# keep everything inside the rounded plate
clip = Image.new('RGBA', (W, W), (0, 0, 0, 0)); clip.paste(out, (0, 0), mask)
clip.resize((N, N), Image.LANCZOS).save(OUT)
print('wrote', OUT)
