"""Add lunar south-pole base targets to the terrain comparison.

Source: NASA LRO LOLA gridded topography, LDEM_80S_80M (80 m/pixel, polar stereographic,
80-90 deg S), from the PDS Geosciences / MIT LOLA archive:
https://imbrium.mit.edu/DATA/LOLA_GDR/POLAR/IMG/LDEM_80S_80M.IMG

    python scripts/add_moon.py path/to/LDEM_80S_80M.IMG

Each target uses the same 25 x 25 km window and 500 m grid as every other site
(build_terrain.SIZE / SPACING), sampled directly in the polar stereographic plane, where
the scale error near the pole is under 0.2 percent. Results are appended to
public/terrain/sites.json; existing entries are kept.
"""
import json
import math
import sys
from pathlib import Path

import numpy as np
from scipy.ndimage import map_coordinates

from build_terrain import SIZE, SPACING, summarize

LOLA_URL = 'https://imbrium.mit.edu/DATA/LOLA_GDR/POLAR/IMG/LDEM_80S_80M.IMG'
RADIUS = 1737400.0
PIXELS = 7600
SCALE = 80.0            # metres per pixel (MAP_SCALE)
OFFSET = 3799.5         # LINE/SAMPLE_PROJECTION_OFFSET
DN_TO_M = 0.5           # SCALING_FACTOR

TARGETS = [
    dict(id='shackleton', name='Shackleton crater rim', planet='Moon', lat=-89.67, lon=129.78,
         note='Lunar south pole site of NASA\'s Artemis Base Camp concept: sunlit rim, ice in the shadowed floor'),
    dict(id='malapert', name='Malapert Massif', planet='Moon', lat=-86.0, lon=0.0,
         note='One of NASA\'s nine Artemis III candidate landing regions near the lunar south pole'),
]


def project(lat, lon):
    """South polar stereographic (PDS DSMAP_POLAR): metres from the pole in the map plane."""
    rho = 2 * RADIUS * math.tan(math.pi / 4 + math.radians(lat) / 2)
    return rho * math.sin(math.radians(lon)), rho * math.cos(math.radians(lon))


def sample(dem, lat, lon, flip):
    x0, y0 = project(lat, lon)
    offsets = np.arange(-(SIZE // 2), SIZE // 2 + 1) * SPACING
    gx, gy = np.meshgrid(offsets, offsets)
    x, y = x0 + gx, y0 - gy                       # grid row 0 = map "up"
    col = OFFSET + x / SCALE
    row = OFFSET + (y / SCALE if flip else -y / SCALE)
    values = map_coordinates(dem, [row, col], order=1, output=float, mode='constant', cval=np.nan)
    if not np.isfinite(values).all():
        raise ValueError('window falls outside the DEM')
    return values * DN_TO_M


def main():
    dem = np.memmap(sys.argv[1], dtype='<i2', mode='r', shape=(PIXELS, PIXELS)).astype(np.float32)
    # Orientation check: Shackleton's 4 km-deep bowl must sit in the middle of its window.
    lat, lon = TARGETS[0]['lat'], TARGETS[0]['lon']
    scores = {}
    for flip in (False, True):
        h = sample(dem, lat, lon, flip)
        centre = h[SIZE // 2 - 3:SIZE // 2 + 4, SIZE // 2 - 3:SIZE // 2 + 4].mean()
        scores[flip] = (h.max() - centre, h.min(), h.max())
        print(f'flip={flip}: centre {centre:.0f} m, min {h.min():.0f}, max {h.max():.0f}, rim-centre {h.max() - centre:.0f}')
    flip = max(scores, key=lambda f: scores[f][0])
    print('using flip =', flip)

    out = Path(__file__).resolve().parents[1] / 'public' / 'terrain'
    records = json.loads((out / 'sites.json').read_text(encoding='utf-8'))
    known = {r['id'] for r in records}
    # Moon targets go right after the Mars target so targets come first in the file.
    insert_at = next(i for i, r in enumerate(records) if r['planet'] == 'Earth')
    for target in TARGETS:
        if target['id'] in known:
            print('skip', target['id']); continue
        meta = dict(target, source='NASA LRO LOLA (LDEM_80S_80M)', url=LOLA_URL)
        record = summarize(meta, sample(dem, target['lat'], target['lon'], flip), out)
        records.insert(insert_at, record); insert_at += 1
        print(record['id'], record['relief'], record['median'], record['p90'])
    (out / 'sites.json').write_text(json.dumps(records, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
