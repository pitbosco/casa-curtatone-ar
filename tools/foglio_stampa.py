"""Fogli A4 per la mostra: marker in alto, QR code e istruzioni in basso.
Uso: python tools/foglio_stampa.py  ->  stampa/foglio-mostra-A4.pdf e stampa/foglio-mostra-A4-cornice.pdf"""
import os
import pymupdf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ST = os.path.join(ROOT, 'stampa')
MM = 72 / 25.4
BLU = (1 / 255, 24 / 255, 88 / 255)
GRIGIO = (0.35, 0.37, 0.45)
F = r'C:\Windows\Fonts'
URL = 'pitbosco.github.io/casa-curtatone-ar'


def r(x, y, w, h):
    return pymupdf.Rect(x * MM, y * MM, (x + w) * MM, (y + h) * MM)


def foglio(out, marker_pdf=None, marker_png=None):
    doc = pymupdf.open()
    p = doc.new_page(width=210 * MM, height=297 * MM)
    for name, file in [('georgiab', 'georgiab.ttf'), ('georgia', 'georgia.ttf'), ('segoe', 'segoeui.ttf'), ('segoeb', 'segoeuib.ttf')]:
        p.insert_font(fontname=name, fontfile=os.path.join(F, file))

    # marker 190 x 190 mm (il riconoscimento non dipende dalla misura, ma va stampato intero e non deformato)
    box = r(10, 8, 190, 190)
    if marker_pdf:
        p.show_pdf_page(box, pymupdf.open(marker_pdf), 0)
    else:
        p.insert_image(box, filename=marker_png)

    # filetto
    p.draw_line(pymupdf.Point(10 * MM, 206 * MM), pymupdf.Point(200 * MM, 206 * MM), color=BLU, width=0.8)

    # QR code (vettoriale)
    qr = pymupdf.open(os.path.join(ST, 'qr.svg'))
    qr_pdf = pymupdf.open('pdf', qr.convert_to_pdf())
    p.show_pdf_page(r(12, 214, 62, 62), qr_pdf, 0)
    p.insert_text((12 * MM, 282 * MM), 'Inquadra con la fotocamera', fontname='segoe', fontsize=8.5, color=GRIGIO)

    # testi
    x = 84 * MM
    p.insert_text((x, 223 * MM), 'Casa Curtatone', fontname='georgiab', fontsize=24, color=BLU)
    p.insert_text((x, 230.5 * MM), 'Sergio Jaretti · Elio Luzi — Torino, 1965–66', fontname='georgia', fontsize=10.5, color=BLU)
    p.insert_text((x, 241 * MM), "IL MODELLO 3D IN REALTÀ AUMENTATA", fontname='segoeb', fontsize=8.5, color=BLU)
    passi = [
        ('1', 'Inquadra il QR code con la fotocamera del telefono e apri il link.'),
        ('2', 'Premi «Avvia» e consenti fotocamera e movimento.'),
        ('3', 'Inquadra il disegno qui sopra: la casa compare sul foglio.'),
        ('4', '«Blocca» la tiene ferma mentre le giri intorno; «Nella stanza» la appoggia sul pavimento.'),
    ]
    y = 246
    font = pymupdf.Font(fontfile=os.path.join(F, 'segoeui.ttf'))
    larghezza = 200 * MM - (x + 5 * MM)
    for n, t in passi:
        righe = 1 + int(font.text_length(t, fontsize=9.5) // (larghezza * 0.97))
        p.insert_text((x, (y + 3.3) * MM), n, fontname='segoeb', fontsize=10, color=BLU)
        rc = pymupdf.Rect(x + 5 * MM, y * MM, 200 * MM, (y + 5 * righe + 2) * MM)
        p.insert_textbox(rc, t, fontname='segoe', fontsize=9.5, color=(0.1, 0.1, 0.15), lineheight=1.3)
        y += 5 * righe + 2.5
    p.insert_text((x, 287 * MM), URL, fontname='segoe', fontsize=8.5, color=GRIGIO)

    doc.save(out, garbage=4, deflate=True)
    print('OK', out)


foglio(os.path.join(ST, 'foglio-mostra-A4.pdf'), marker_pdf=os.path.join(ST, 'marker_pianta_foglio_20x20cm.pdf'))
foglio(os.path.join(ST, 'foglio-mostra-A4-cornice.pdf'), marker_png=os.path.join(ST, 'marker-pianta-plus-3600.png'))
