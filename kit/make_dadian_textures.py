"""Author the dadian plaque texture locally (no external services).

kit/textures/dadian-plaque.png  (2048x768, sRGB)
  Black lacquer ground with gold double border + corner accents (same
  language as the shanmen plaque). Three characters laid out LEFT-TO-RIGHT
  as 廟 隍 城 — the traditional reading order is right-to-left and yields
  城隍廟, matching photo PBR-SH-0005-004 (2015-12-09, CC BY-SA 4.0).
  Glyphs rasterized from the system Noto Serif CJK Bold font; layout,
  borders and mottling authored here. No reference-photo pixels.

Run: python3 -X utf8 kit/make_dadian_textures.py
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = Path(__file__).resolve().parent
TEX = HERE / 'textures'
FONT = '/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc'


def lacquer_mottle(w, h, rng):
    base = np.full((h, w, 3), 0.0, dtype=np.float64)
    small = rng.normal(0, 1, (h // 8, w // 8, 1))
    small = np.kron(small, np.ones((8, 8, 1)))
    small = small[:h, :w]
    layer = np.array([0.075, 0.072, 0.066]) + 0.012 * small
    return np.clip(layer, 0, 1)


def make_plaque():
    W, H = 2048, 768
    rng = np.random.default_rng(20260916)
    img = lacquer_mottle(W, H, rng)
    yy = np.linspace(-1, 1, H)[:, None]
    sheen = 0.018 * np.exp(-(yy + 0.25) ** 2 / 0.18)
    img += sheen[..., None] * np.array([1.0, 0.92, 0.72])

    gold = np.array([0.855, 0.70, 0.42])
    gold_deep = np.array([0.62, 0.47, 0.24])

    pil = Image.fromarray(np.clip(img * 255, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(pil)

    def gold_blend(c, k):
        return tuple(int(v) for v in np.clip(c * k, 0, 255))

    m_out, w_out = 26, 14
    d.rectangle([m_out, m_out, W - m_out, H - m_out], outline=gold_blend(gold * 255, 1.0), width=w_out)
    d.rectangle([m_out + 34, m_out + 34, W - m_out - 34, H - m_out - 34],
                outline=gold_blend(gold_deep * 255, 1.0), width=5)
    for cx, cy in [(m_out + 7, m_out + 7), (W - m_out - 7, m_out + 7),
                   (m_out + 7, H - m_out - 7), (W - m_out - 7, H - m_out - 7)]:
        d.ellipse([cx - 30, cy - 30, cx + 30, cy + 30], fill=gold_blend(gold_deep * 255, 1.05))

    # three characters, laid out left -> right: 廟 隍 城 (read right-to-left as 城隍廟)
    chars = '廟隍城'
    pad = 150
    cell = (W - 2 * pad) / 3
    size = int(cell * 0.78)
    font = ImageFont.truetype(FONT, size)
    for i, ch in enumerate(chars):
        bbox = font.getbbox(ch)
        cw, chh = bbox[2] - bbox[0], bbox[3] - bbox[1]
        x0 = pad + i * cell + (cell - cw) / 2 - bbox[0]
        y0 = (H - chh) / 2 - bbox[1]
        for off, col in ((5, (38, 26, 12)), (0, tuple(int(v) for v in gold_deep * 255))):
            d.text((x0 + off, y0 + off), ch, font=font, fill=col)
        d.text((x0, y0), ch, font=font, fill=tuple(int(v) for v in gold * 255))
    pil = pil.filter(ImageFilter.GaussianBlur(0.4))

    out = TEX / 'dadian-plaque.png'
    pil.save(out, optimize=True)
    return {
        'file': str(out.relative_to(HERE)), 'size': [W, H], 'colorSpace': 'sRGB',
        'charactersLeftToRight': chars, 'readingRightToLeft': '城隍廟',
        'evidence': 'photo PBR-SH-0005-004 (batch-005, CC BY-SA 4.0): outer plaque 城隍廟 right-to-left',
        'font': {'path': FONT, 'name': 'Noto Serif CJK SC Bold (system package)',
                 'license': 'SIL Open Font License 1.1 (Noto family)'},
        'note': 'glyph shapes from the recorded system font; layout/borders/mottling authored locally; no reference-photo pixels',
    }


def main():
    TEX.mkdir(exist_ok=True)
    plaque = make_plaque()
    sidecar = {
        'generatedBy': 'kit/make_dadian_textures.py',
        'newImageBudget': {'max': 1, 'used': 1, 'maxEdgePx': 2048},
        'images': [plaque],
    }
    (TEX / 'dadian-textures.json').write_text(json.dumps(sidecar, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    p = HERE / plaque['file']
    print(f"TEXTURE_READY {p.name} {plaque['size']} {p.stat().st_size}B")


if __name__ == '__main__':
    main()
