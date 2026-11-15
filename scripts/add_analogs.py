"""Add more well-known Mars analog sites to the terrain comparison.

Uses the same window, grid, sampling and statistics as build_terrain.py, then appends
the new sites to public/terrain/sites.json (existing entries are kept as they are).

    python scripts/add_analogs.py <folder with the .hgt.gz tiles> [path/to/N38W111.hgt.gz]

Each window centre is placed so the whole 25 x 25 km window stays inside one 1-degree
Skadi tile. If the Hanksville tile is given, its statistics are recomputed first as a
check that this script matches the bundled data.
"""
import json
import sys
from pathlib import Path

import numpy as np

from build_terrain import SKADI, SPACING, hgt, sample, summarize

ANALOGS = [
    dict(id='devon', name='Haughton Crater, Devon Island', planet='Earth', lat=75.38, lon=-89.50,
         note='Arctic impact crater used by the NASA Haughton-Mars Project', tile='N75/N75W090', south=75, west=-90),
    dict(id='mojave', name='Dumont Dunes, Mojave Desert', planet='Earth', lat=35.68, lon=-116.22,
         note='Where NASA JPL tested Mars rover driving on dunes', tile='N35/N35W117', south=35, west=-117),
    dict(id='riotinto', name='Río Tinto, Spain', planet='Earth', lat=37.69, lon=-6.59,
         note='Acidic, iron-rich ground studied as a Mars chemistry analog', tile='N37/N37W007', south=37, west=-7),
    dict(id='holuhraun', name='Holuhraun lava field, Iceland', planet='Earth', lat=64.87, lon=-16.70,
         note='Young basalt lava field used for Mars field tests', tile='N64/N64W017', south=64, west=-17),
    # Lunar analogs (window centres shifted so each 25 km window fits one tile; the feature stays inside)
    dict(id='askja', name='Askja caldera, Iceland', planet='Earth', lat=65.12, lon=-16.71,
         note='Volcanic caldera where NASA trained Apollo astronauts in lunar geology', tile='N65/N65W017', south=65, west=-17),
    dict(id='maunakea', name='Mauna Kea, Hawaii', planet='Earth', lat=19.82, lon=-155.47,
         note='Volcanic slopes where NASA, CSA and DLR tested lunar resource extraction (2010, 2012)', tile='N19/N19W156', south=19, west=-156),
    dict(id='meteorcrater', name='Meteor Crater, Arizona', planet='Earth', lat=35.12, lon=-111.14,
         note='Impact crater where NASA trained Apollo astronauts, and still trains them', tile='N35/N35W112', south=35, west=-112),
]


def stats(heights):
    dy, dx = np.gradient(heights, SPACING)
    slope = np.degrees(np.arctan(np.hypot(dx, dy)))[1:-1, 1:-1]
    return round(float(np.ptp(heights)), 1), round(float(np.median(slope)), 2), round(float(np.percentile(slope, 90)), 2)


def main():
    tiles = Path(sys.argv[1])
    out = Path(__file__).resolve().parents[1] / 'public' / 'terrain'
    records = json.loads((out / 'sites.json').read_text(encoding='utf-8'))
    if len(sys.argv) > 2:
        check = stats(sample(hgt(sys.argv[2]), 38.40, -110.70, south=38, west=-111))
        stored = next(r for r in records if r['id'] == 'utah')
        print('Hanksville check', check, 'stored', (stored['relief'], stored['median'], stored['p90']))
        assert check == (stored['relief'], stored['median'], stored['p90']), 'method mismatch'
    known = {r['id'] for r in records}
    for site in ANALOGS:
        if site['id'] in known:
            print('skip', site['id']); continue
        raster = hgt(tiles / (site['tile'].split('/')[1] + '.hgt.gz'))
        meta = {k: site[k] for k in ('id', 'name', 'planet', 'lat', 'lon', 'note')}
        meta.update(source='Mapzen Skadi elevation', url=f"{SKADI}/{site['tile']}.hgt.gz")
        record = summarize(meta, sample(raster, site['lat'], site['lon'], south=site['south'], west=site['west']), out)
        records.append(record)
        print(record['id'], record['relief'], record['median'], record['p90'])
    (out / 'sites.json').write_text(json.dumps(records, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
