"""R2 #2 bean-atlas measurement: per-variant base/frost fractions and convex-face
concentration of the sugar frosting. Shared by kit/texlib.py (calibration report)
and tests/test_beans.py (assertion) so both use the same classifier.
System python3 -X utf8 with PIL + numpy."""
import numpy as np

SKIN = (138, 106, 72)   # 8a6a48 - required dominant base
FROST_LUM = 185         # >= counts as frosting white
BASE_TOL = (28, 28, 30)


def measure(img):
    """img: PIL RGB image, 1024 (or 512) square atlas: 2 cols x 3 rows, one cell per
    variant; variant k sits at atlas column k%2, image-row block (2 - k//2).
    Returns one stats dict per variant k = 0..5."""
    a = np.asarray(img.convert('RGB'), np.int16)
    H, W = a.shape[:2]
    cw, ch = W // 2, H // 3
    lum = a @ np.array([.2126, .7152, .0722])
    out = []
    for k in range(6):
        col, row = k % 2, k // 2
        y0, y1 = (2 - row) * ch, (3 - row) * ch          # image row 0 = atlas v 1
        x0, x1 = col * cw, (col + 1) * cw
        cell = a[y0:y1, x0:x1]
        cl = lum[y0:y1, x0:x1]
        frost = cl >= FROST_LUM
        base = ((np.abs(cell[:, :, 0] - SKIN[0]) <= BASE_TOL[0])
                & (np.abs(cell[:, :, 1] - SKIN[1]) <= BASE_TOL[1])
                & (np.abs(cell[:, :, 2] - SKIN[2]) <= BASE_TOL[2]))
        v = (np.arange(y0, y1)[:, None] + 0.5) / H       # atlas v bottom-up
        cv = np.broadcast_to((v - row / 3) * 3, cl.shape)  # cell v: 0/1 = broad faces
        polar = (cv < 0.25) | (cv > 0.75)
        equat = (cv > 0.35) & (cv < 0.65)
        f_p = float(frost[polar].mean()) if polar.any() else 0.0
        f_e = float(frost[equat].mean()) if equat.any() else 0.0
        out.append({'variant': k + 1,
                    'baseFrac': round(float(base.mean()), 4),
                    'frostFrac': round(float(frost.mean()), 4),
                    'frostPolar': round(f_p, 4),
                    'frostEquator': round(f_e, 4),
                    'convexRatio': round(f_p / f_e, 2) if f_e > 1e-4 else None})
    return out
