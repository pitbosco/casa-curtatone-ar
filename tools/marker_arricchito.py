"""Variante del marker della mostra: l'icona originale resta intatta al centro, intorno
cornice e testi nello stesso blu, che aggiungono punti di riconoscimento per il tracking.
Uso: python tools/marker_arricchito.py [scala]
  scala 1 -> assets/marker-pianta-plus.png (1200 px, per compilare il .mind)
  scala 3 -> stampa/marker-pianta-plus-3600.png (per la stampa)"""
import os, sys
import pymupdf
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BLU = (1, 24, 88)
F = r'C:\Windows\Fonts'

K = int(sys.argv[1]) if len(sys.argv) > 1 else 1
page = pymupdf.open(os.path.join(ROOT, 'stampa', 'marker_pianta_foglio_20x20cm.pdf'))[0]
z = 1200 * K / page.rect.width
pix = page.get_pixmap(matrix=pymupdf.Matrix(z, z))
img = Image.frombytes('RGB', (pix.width, pix.height), pix.samples)
S = img.width
class Scaled:  # disegna con le coordinate della versione da 1200 px
    def __init__(self, d): self.d = d
    def _k(self, xy): return [v * K for v in xy]
    def rectangle(self, xy, outline=None, width=1, fill=None): self.d.rectangle(self._k(xy), outline=outline, width=width * K, fill=fill)
    def line(self, xy, fill=None, width=1): self.d.line(self._k(xy), fill=fill, width=width * K)
    def text(self, xy, t, font=None, fill=None): self.d.text(self._k(xy), t, font=font, fill=fill)
d = Scaled(ImageDraw.Draw(img))
S = 1200

# cornice doppia
d.rectangle([24, 24, S - 25, S - 25], outline=BLU, width=14)
d.rectangle([52, 52, S - 53, S - 53], outline=BLU, width=3)

# segni di registro agli angoli, diversi tra loro (rompono la simmetria)
for (x, y, sx, sy, n) in [(52, 52, 1, 1, 3), (S - 53, 52, -1, 1, 2), (52, S - 53, 1, -1, 1), (S - 53, S - 53, -1, -1, 4)]:
    for k in range(n):
        o = 22 + k * 16
        d.line([x + sx * o, y, x + sx * o, y + sy * 26], fill=BLU, width=4)
    xa, xb, ya, yb = x + sx * 10, x + sx * 18, y + sy * 34, y + sy * 42
    d.rectangle([min(xa, xb), min(ya, yb), max(xa, xb), max(ya, yb)], fill=BLU)

# testi
title = ImageFont.truetype(os.path.join(F, 'georgiab.ttf'), 92 * K)
sub = ImageFont.truetype(os.path.join(F, 'georgia.ttf'), 40 * K)
small = ImageFont.truetype(os.path.join(F, 'segoeuib.ttf'), 26 * K)
d.text((96, 92), 'CASA CURTATONE', font=title, fill=BLU)
d.text((98, 200), 'Sergio Jaretti · Elio Luzi — Torino, 1965–66', font=sub, fill=BLU)
d.text((96, S - 200), 'VIA CURTATONE 1 · TORINO', font=small, fill=BLU)
d.text((96, S - 160), 'INQUADRA PER VEDERE IL MODELLO 3D', font=small, fill=BLU)

# scala grafica con tacche irregolari
x0, y0 = S - 460, S - 150
d.rectangle([x0, y0, x0 + 360, y0 + 14], outline=BLU, width=3)
for i, w in enumerate([40, 70, 50, 90, 110]):
    xs = x0 + sum([40, 70, 50, 90, 110][:i])
    if i % 2 == 0:
        d.rectangle([xs, y0, xs + w, y0 + 14], fill=BLU)
for t, x in []:  # niente misure: l'icona non è in scala
    d.text((x - 4, y0 + 22), t, font=small, fill=BLU)

out = os.path.join(ROOT, 'assets', 'marker-pianta-plus.png') if K == 1 else os.path.join(ROOT, 'stampa', f'marker-pianta-plus-{1200 * K}.png')
img.save(out)
print('ok', out)
