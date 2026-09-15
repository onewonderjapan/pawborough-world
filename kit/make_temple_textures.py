"""Author the two new temple textures locally (no external services).

1) kit/textures/temple-plaque.png  (<=2048px edge, color, sRGB)
   Black lacquer ground with locally-drawn gold border lines and the four
   plaque characters laid out LEFT-TO-RIGHT as 隅 海 障 保 — the traditional
   reading order is right-to-left and yields 保障海隅. Glyphs are rasterized
   from the system Noto Serif CJK Bold font (source recorded in the sidecar);
   the layout, borders and mottling are authored here.

2) kit/textures/temple-relief-normal.png (1024, normal map, Non-Color)
   Original simplified shallow-relief height field for the wing-wall panels:
   a lobed floral outer frame (petal arcs), an inner diamond, quiet foliage
   curls inside, flat stone field elsewhere. Baked to an OpenGL normal map
   (green channel = +V up), never copied from the reference photo.

Run: python3 -X utf8 kit/make_temple_textures.py
"""
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = Path(__file__).resolve().parent
TEX = HERE / 'textures'
FONT = '/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc'


def lacquer_mottle(w, h, rng):
    """Very quiet dark mottling so the lacquer is not a flat void."""
    base = np.full((h, w, 3), 0.0, dtype=np.float64)
    small = rng.normal(0, 1, (h // 8, w // 8, 1))
    small = np.kron(small, np.ones((8, 8, 1)))
    small = small[:h, :w]
    layer = np.array([0.075, 0.072, 0.066]) + 0.012 * small
    return np.clip(layer, 0, 1)


def make_plaque():
    W, H = 2048, 720
    rng = np.random.default_rng(20260915)
    img = lacquer_mottle(W, H, rng)
    # subtle horizontal sheen band (hand-rubbed lacquer), no photo source
    yy = np.linspace(-1, 1, H)[:, None]
    sheen = 0.018 * np.exp(-(yy + 0.25) ** 2 / 0.18)
    img += sheen[..., None] * np.array([1.0, 0.92, 0.72])

    gold = np.array([0.855, 0.70, 0.42])
    gold_deep = np.array([0.62, 0.47, 0.24])

    pil = Image.fromarray(np.clip(img * 255, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(pil)

    def gold_blend(c, k):
        return tuple(int(v) for v in np.clip(c * k, 0, 255))

    # double border: heavy outer frame + thin inner line, corners accented
    m_out, w_out = 26, 14
    d.rectangle([m_out, m_out, W - m_out, H - m_out], outline=gold_blend(gold * 255, 1.0), width=w_out)
    d.rectangle([m_out + 34, m_out + 34, W - m_out - 34, H - m_out - 34],
                outline=gold_blend(gold_deep * 255, 1.0), width=5)
    for cx, cy in [(m_out + 7, m_out + 7), (W - m_out - 7, m_out + 7),
                   (m_out + 7, H - m_out - 7), (W - m_out - 7, H - m_out - 7)]:
        d.ellipse([cx - 30, cy - 30, cx + 30, cy + 30], fill=gold_blend(gold_deep * 255, 1.05))

    # four characters, laid out left -> right: 隅 海 障 保
    chars = '隅海障保'
    pad = 120
    cell = (W - 2 * pad) / 4
    size = int(cell * 0.78)
    font = ImageFont.truetype(FONT, size)
    for i, ch in enumerate(chars):
        bbox = font.getbbox(ch)
        cw, chh = bbox[2] - bbox[0], bbox[3] - bbox[1]
        x0 = pad + i * cell + (cell - cw) / 2 - bbox[0]
        y0 = (H - chh) / 2 - bbox[1]
        # layered strokes: dark under-stroke then two gold passes = engraved leaf
        for off, col in ((5, (38, 26, 12)), (0, tuple(int(v) for v in gold_deep * 255))):
            d.text((x0 + off, y0 + off), ch, font=font, fill=col)
        d.text((x0, y0), ch, font=font, fill=tuple(int(v) for v in gold * 255))
    pil = pil.filter(ImageFilter.GaussianBlur(0.4))

    out = TEX / 'temple-plaque.png'
    pil.save(out, optimize=True)
    return {
        'file': str(out.relative_to(HERE)), 'size': [W, H], 'colorSpace': 'sRGB',
        'charactersLeftToRight': chars, 'readingRightToLeft': '保障海隅',
        'font': {'path': FONT, 'name': 'Noto Serif CJK SC Bold (system package)',
                 'license': 'SIL Open Font License 1.1 (Noto family)'},
        'note': 'glyph shapes from the recorded system font; layout/borders/mottling authored locally; no reference-photo pixels',
    }


def relief_height(w, h):
    """Height field in [0,1]: lobed frame + diamond + foliage, flat field."""
    xs = np.linspace(-1, 1, w)
    ys = np.linspace(-1, 1, h)
    X, Y = np.meshgrid(xs, ys)
    R = np.hypot(X, Y)
    TH = np.arctan2(Y, X)

    # lobed floral outer frame: radius modulated by petals (8 lobes)
    petals = 8
    frame_r = 0.80 + 0.062 * np.cos(petals * TH) ** 2
    frame_band = np.clip(1 - np.abs(R - frame_r) / 0.115, 0, 1)
    frame = frame_band ** 1.5

    # inner diamond ring (rotated square), the lead-corrected motif core
    diamond_r = 0.80 / np.sqrt(2) * 1.02
    D = np.abs(X) + np.abs(Y)
    diamond_band = np.clip(1 - np.abs(D - diamond_r) / 0.075, 0, 1) ** 1.4
    frame = np.maximum(frame, diamond_band * 0.9)

    # foliage curls inside the diamond: two rotated sine brushes
    curl = 0.16 * np.clip(np.sin(3.1 * TH + 2 * D) * np.cos(2.3 * TH - 1.5 * D), 0, 1)
    inside = np.clip((diamond_r - D) / 0.12, 0, 1) * np.clip(1 - D / (diamond_r + 0.05), 0, 1)
    foliage = curl * inside

    # tiny central boss
    boss = 0.28 * np.clip(1 - R / 0.10, 0, 1) ** 2

    Hf = np.clip(frame * 0.78 + foliage * 0.55 + boss, 0, 1)

    # stone field: faint directional raking so flat areas still shade quietly
    field = 0.05 * np.clip(np.sin(46 * X + 31 * Y) * 0.5 + 0.5, 0, 1) * np.clip(1 - R / 1.02, 0, 1) * 0.5
    return np.clip(Hf + field, 0, 1)


def make_relief_normal():
    W = H = 1024
    hmap = relief_height(W, H).astype(np.float64)
    # finite-difference gradient; strong normalizing scale keeps relief shallow
    strength = 2.6
    dy, dx = np.gradient(hmap)
    # OpenGL convention: +X right, +Y up in UV space; rows grow downward, so
    # the vertical gradient is negated before encoding
    nx = -dx * strength * W / 2
    ny = dy * strength * H / 2
    ny = -ny
    nz = np.ones_like(hmap)
    length = np.sqrt(nx ** 2 + ny ** 2 + nz ** 2)
    rgb = np.stack([nx / length, ny / length, nz / length], axis=-1)
    rgb = rgb * 0.5 + 0.5
    out = TEX / 'temple-relief-normal.png'
    Image.fromarray(np.clip(rgb * 255, 0, 255).astype(np.uint8)).save(out, optimize=True)
    return {
        'file': str(out.relative_to(HERE)), 'size': [W, H], 'colorSpace': 'Non-Color',
        'normalConvention': 'OpenGL (+Y up in UV)', 'motif': 'lobed floral frame + inner diamond + foliage, original',
        'note': 'procedural height field authored locally; no reference-photo-derived pixels',
    }


def main():
    TEX.mkdir(exist_ok=True)
    plaque = make_plaque()
    relief = make_relief_normal()
    sidecar = {
        'generatedBy': 'kit/make_temple_textures.py',
        'newImageBudget': {'max': 2, 'used': 2, 'maxEdgePx': 2048},
        'images': [plaque, relief],
    }
    (TEX / 'temple-textures.json').write_text(json.dumps(sidecar, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    for im in (plaque, relief):
        p = HERE / im['file']
        print(f"TEXTURE_READY {p.name} {im['size']} {p.stat().st_size}B")


if __name__ == '__main__':
    main()
