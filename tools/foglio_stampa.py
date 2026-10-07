"""Foglio quadrato per la mostra, compatto: disegno ritagliato sul contenuto, sotto QR code e istruzioni.
Uso: python tools/foglio_stampa.py  ->  stampa/foglio-mostra.pdf"""
import os
import pymupdf
from PIL import Image, ImageOps

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ST = os.path.join(ROOT, 'stampa')
MM = 72 / 25.4
BLU = (1 / 255, 24 / 255, 88 / 255)
NERO = (0.1, 0.1, 0.15)
F = r'C:\Windows\Fonts'

LATO = 200      # foglio 20 x 20 cm
MARGINE = 8
GAP = 7         # spazio tra disegno e riga sotto

src = pymupdf.open(os.path.join(ST, 'marker_pianta_foglio_20x20cm.pdf'))
page = src[0]

# Ritaglio del disegno sul suo contenuto (il PDF originale ha ampi margini bianchi).
z = 4
pix = page.get_pixmap(matrix=pymupdf.Matrix(z, z))
img = Image.frombytes('RGB', (pix.width, pix.height), pix.samples)
x0, y0, x1, y1 = ImageOps.invert(img.convert('L')).point(lambda v: 255 if v > 24 else 0).getbbox()
pad = 1.5
clip = pymupdf.Rect(x0 / z - pad, y0 / z - pad, x1 / z + pad, y1 / z + pad)
ratio = clip.height / clip.width

doc = pymupdf.open()
p = doc.new_page(width=LATO * MM, height=LATO * MM)
for name, file in [('georgiab', 'georgiab.ttf'), ('segoe', 'segoeui.ttf'), ('segoeb', 'segoeuib.ttf')]:
    p.insert_font(fontname=name, fontfile=os.path.join(F, file))

# Disegno a tutta larghezza
w = LATO - 2 * MARGINE
h = w * ratio
p.show_pdf_page(pymupdf.Rect(MARGINE * MM, MARGINE * MM, (MARGINE + w) * MM, (MARGINE + h) * MM), src, 0, clip=clip)

# Riga sotto: QR a sinistra (alto quanto lo spazio rimasto), testi a destra
top = MARGINE + h + GAP
qr_size = LATO - MARGINE - top
qr = pymupdf.open(os.path.join(ST, 'qr.svg'))
p.show_pdf_page(pymupdf.Rect(MARGINE * MM, top * MM, (MARGINE + qr_size) * MM, (top + qr_size) * MM), pymupdf.open('pdf', qr.convert_to_pdf()), 0)

x = (MARGINE + qr_size + 7) * MM
passi = ['Inquadra il QR code e apri il link.', 'Esplora il modello.']
riga = qr_size / 3.2  # titolo + 2 passi distribuiti sull'altezza del QR
p.insert_text((x, (top + riga * 0.62) * MM), 'Casa Curtatone in 3D', fontname='georgiab', fontsize=25, color=BLU)
for i, t in enumerate(passi, 1):
    y = top + riga * (1.2 + (i - 1) * 0.95)
    p.draw_circle(pymupdf.Point(x + 4.2 * MM, (y + 2.6) * MM), 4.2 * MM, color=BLU, fill=BLU)
    p.insert_text((x + (2.75 if i == 1 else 2.4) * MM, (y + 4.9) * MM), str(i), fontname='segoeb', fontsize=16, color=(1, 1, 1))
    p.insert_text((x + 11.5 * MM, (y + 4.8) * MM), t, fontname='segoe', fontsize=18, color=NERO)

out = os.path.join(ST, 'foglio-mostra.pdf')
doc.save(out, garbage=4, deflate=True)
print(f'OK {out}  disegno {w:.0f}x{h:.0f} mm, QR {qr_size:.0f} mm')
