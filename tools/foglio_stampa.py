"""Foglio quadrato per la mostra: disegno (marker) in alto, QR code e istruzioni in basso.
Uso: python tools/foglio_stampa.py [proposta]   (A, B o C; senza argomento: tutte e tre)
  ->  stampa/foglio-mostra-<proposta>.pdf (icona originale) e stampa/foglio-mostra-<proposta>-cornice.pdf"""
import os
import sys
import pymupdf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ST = os.path.join(ROOT, 'stampa')
MM = 72 / 25.4
LATO = 300  # foglio quadrato 30 x 30 cm
BLU = (1 / 255, 24 / 255, 88 / 255)
NERO = (0.1, 0.1, 0.15)
F = r'C:\Windows\Fonts'

# Tre proposte di istruzioni, pensate per chi non usa spesso lo smartphone.
PROPOSTE = {
    'A': {  # essenziale
        'titolo': 'Guarda la casa in 3D',
        'passi': [
            'Inquadra il codice qui accanto con la fotocamera del telefono.',
            'Tocca il link, poi premi «Inizia» e «Consenti».',
            'Punta il telefono sul disegno: la casa appare sopra.',
        ],
        'nota': None,
    },
    'B': {  # essenziale + come usare i pulsanti
        'titolo': 'Guarda la casa in 3D',
        'passi': [
            'Inquadra il codice qui accanto con la fotocamera del telefono.',
            'Tocca il link, poi premi «Inizia» e «Consenti».',
            'Punta il telefono sul disegno: la casa appare sopra.',
        ],
        'nota': 'Con i pulsanti + e − la ingrandisci, con la freccia la giri. «Nella stanza» la appoggia sul pavimento.',
    },
    'C': {  # invito, tono colloquiale
        'titolo': 'Vuoi vedere la casa in 3D?',
        'passi': [
            'Apri la fotocamera del telefono e inquadra il codice.',
            'Tocca il link che compare, poi «Inizia».',
            'Punta il telefono sul disegno e giragli intorno.',
        ],
        'nota': 'Non serve scaricare nessuna app.',
    },
}


def r(x, y, w, h):
    return pymupdf.Rect(x * MM, y * MM, (x + w) * MM, (y + h) * MM)


def foglio(out, testi, marker_pdf=None, marker_png=None):
    doc = pymupdf.open()
    p = doc.new_page(width=LATO * MM, height=LATO * MM)
    for name, file in [('georgiab', 'georgiab.ttf'), ('georgia', 'georgia.ttf'), ('segoe', 'segoeui.ttf'), ('segoeb', 'segoeuib.ttf')]:
        p.insert_font(fontname=name, fontfile=os.path.join(F, file))

    # disegno 200 x 200 mm, centrato (va stampato intero e non deformato)
    box = r((LATO - 200) / 2, 8, 200, 200)
    if marker_pdf:
        p.show_pdf_page(box, pymupdf.open(marker_pdf), 0)
    else:
        p.insert_image(box, filename=marker_png)

    p.draw_line(pymupdf.Point(20 * MM, 215 * MM), pymupdf.Point((LATO - 20) * MM, 215 * MM), color=BLU, width=1)

    # QR code (vettoriale)
    qr = pymupdf.open(os.path.join(ST, 'qr.svg'))
    p.show_pdf_page(r(18, 222, 66, 66), pymupdf.open('pdf', qr.convert_to_pdf()), 0)

    # testi: grandi e brevi
    x = 93 * MM
    p.insert_text((x, 234 * MM), testi['titolo'], fontname='georgiab', fontsize=31, color=BLU)
    y = 242
    for i, t in enumerate(testi['passi'], 1):
        p.draw_circle(pymupdf.Point(x + 4 * MM, (y + 2.6) * MM), 4 * MM, color=BLU, fill=BLU)
        p.insert_text((x + (2.2 if i != 1 else 2.6) * MM, (y + 4.7) * MM), str(i), fontname='segoeb', fontsize=15, color=(1, 1, 1))
        p.insert_text((x + 11 * MM, (y + 4.6) * MM), t, fontname='segoe', fontsize=16.5, color=NERO)
        y += 11
    if testi['nota']:
        rc = pymupdf.Rect(x, (y + 1) * MM, (LATO - 16) * MM, (y + 18) * MM)
        p.insert_textbox(rc, testi['nota'], fontname='segoeb', fontsize=13.5, color=BLU, lineheight=1.3)

    doc.save(out, garbage=4, deflate=True)
    print('OK', out)


scelte = sys.argv[1:] or list(PROPOSTE)
for k in scelte:
    foglio(os.path.join(ST, f'foglio-mostra-{k}.pdf'), PROPOSTE[k], marker_pdf=os.path.join(ST, 'marker_pianta_foglio_20x20cm.pdf'))
    foglio(os.path.join(ST, f'foglio-mostra-{k}-cornice.pdf'), PROPOSTE[k], marker_png=os.path.join(ST, 'marker-pianta-plus-3600.png'))
