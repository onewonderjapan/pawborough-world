"""Author the yimen plaque-pair texture locally (no external services).

kit/textures/yimen-plaques.png (2048x1024, color, sRGB)
Two horizontal plaques in one atlas, one per half:
  top half    — LEFT plaque on the facade; glyphs laid out left->right as
                亡 必 惡 為, traditional reading right-to-left = 為惡必亡
  bottom half — RIGHT plaque; glyphs left->right 昌 必 善 為,
                reading right-to-left = 為善必昌
The lead read both texts from the 040 front photo. Nothing else is guessed:
no couplet, no small characters. Black lacquer ground, gold border and
engraved-leaf glyphs follow the accepted shanmen plaque method
(make_temple_textures.py) so both gates share one material language.

Run: python3 -X utf8 kit/make_yimen_textures.py
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = Path(__file__).resolve().parent
TEX = HERE / 'textures'
FONT = '/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc'

W, H = 2048, 1024
HALF = H // 2


def lacquer_mottle(w, h, rng):
    base = np.full((h, w, 3), 0.0, dtype=np.float64)
    small = rng.normal(0, 1, (h // 8, w // 8, 1))
    small = np.kron(small, np.ones((8, 8, 1)))
    small = small[:h, :w]
    layer = np.array([0.075, 0.072, 0.066]) + 0.012 * small
    return np.clip(layer, 0, 1)


def draw_plaque(d, y0, chars_ltr, gold, gold_deep, edge_y):
    """One plaque row: double gold border + four glyphs, left->right order."""
    def gb(c, k):
        return tuple(int(v) for v in np.clip(c * k, 0, 255))

    m_out, w_out = 16, 9
    d.rectangle([m_out, y0 + m_out, W - m_out, y0 + edge_y - m_out],
                outline=gb(gold * 255, 1.0), width=w_out)
    d.rectangle([m_out + 22, y0 + m_out + 22, W - m_out - 22, y0 + edge_y - m_out - 22],
                outline=gb(gold_deep * 255, 1.0), width=4)
    for cx, cy in [(m_out + 5, y0 + m_out + 5), (W - m_out - 5, y0 + m_out + 5),
                   (m_out + 5, y0 + edge_y - m_out - 5), (W - m_out - 5, y0 + edge_y - m_out - 5)]:
        d.ellipse([cx - 20, cy - 20, cx + 20, cy + 20], fill=gb(gold_deep * 255, 1.05))

    pad = 78
    cell = (W - 2 * pad) / 4
    size = int(cell * 0.74)
    font = ImageFont.truetype(FONT, size)
    for i, ch in enumerate(chars_ltr):
        bbox = font.getbbox(ch)
        cw, chh = bbox[2] - bbox[0], bbox[3] - bbox[1]
        x0 = pad + i * cell + (cell - cw) / 2 - bbox[0]
        yy0 = y0 + (edge_y - chh) / 2 - bbox[1]
        for off, col in ((4, (38, 26, 12)), (0, tuple(int(v) for v in gold_deep * 255))):
            d.text((x0 + off, yy0 + off), ch, font=font, fill=col)
        d.text((x0, yy0), ch, font=font, fill=tuple(int(v) for v in gold * 255))


def main():
    TEX.mkdir(exist_ok=True)
    rng = np.random.default_rng(20260915)
    img = lacquer_mottle(W, H, rng)
    yy = np.linspace(-1, 1, H)[:, None]
    sheen = 0.018 * np.exp(-(yy + 0.25) ** 2 / 0.18)
    img += sheen[..., None] * np.array([1.0, 0.92, 0.72])

    gold = np.array([0.855, 0.70, 0.42])
    gold_deep = np.array([0.62, 0.47, 0.24])
    pil = Image.fromarray(np.clip(img * 255, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(pil)
    # divider between the two plaque halves (matched lacquer, keeps atlas clean)
    d.rectangle([0, HALF - 2, W, HALF + 2], fill=(24, 22, 19))
    draw_plaque(d, 0, '亡必惡為', gold, gold_deep, HALF - 6)      # left plaque
    draw_plaque(d, HALF + 6, '昌必善為', gold, gold_deep, H)      # right plaque
    pil = pil.filter(ImageFilter.GaussianBlur(0.4))

    out = TEX / 'yimen-plaques.png'
    pil.save(out, optimize=True)
    sidecar = {
        'generatedBy': 'kit/make_yimen_textures.py',
        'newImageBudgetThisBatch': {'max': 2, 'used': 1, 'maxEdgePx': 2048},
        'images': [{
            'file': str(out.relative_to(HERE)), 'size': [W, H], 'colorSpace': 'sRGB',
            'atlas': {'topHalf': {'placement': 'facade LEFT', 'charactersLeftToRight': '亡必惡為',
                                  'readingRightToLeft': '為惡必亡'},
                      'bottomHalf': {'placement': 'facade RIGHT', 'charactersLeftToRight': '昌必善為',
                                     'readingRightToLeft': '為善必昌'}},
            'font': {'path': FONT, 'name': 'Noto Serif CJK SC Bold (system package)',
                     'license': 'SIL Open Font License 1.1 (Noto family)'},
            'source': 'texts read by the lead from image PBR-SH-0002-040; no other text guessed',
            'note': 'glyphs from the recorded system font; borders/mottling authored locally; no reference-photo pixels',
        }],
    }
    (TEX / 'yimen-textures.json').write_text(json.dumps(sidecar, ensure_ascii=False, indent=2) + '\n',
                                             encoding='utf-8')
    print(f'TEXTURE_READY {out.name} {W}x{H} {out.stat().st_size}B')


if __name__ == '__main__':
    main()
