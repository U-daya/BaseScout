"""Regenerate bundled DEM summaries from the three source files listed in README."""
import argparse
import gzip
import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import map_coordinates

MOLA = "https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg128/megt44n000hb.img"
SKADI = "https://s3.amazonaws.com/elevation-tiles-prod/skadi"
SPACING = 500
SIZE = 51
GRID = np.meshgrid(*([np.arange(-(SIZE//2), SIZE//2+1) * SPACING] * 2))


def sample(raster, lat, lon, mars=False, south=None, west=None):
    radius = 3396000 if mars else 6371008.8
    x, y = GRID
    # Average sub-samples over each 500 m cell to reduce aliasing on Earth.
    offsets = [0] if mars else np.linspace(-200, 200, 9)
    heights = np.zeros(x.shape)
    for dy in offsets:
        for dx in offsets:
            latitudes = lat - np.degrees((y + dy) / radius)
            longitudes = lon + np.degrees((x + dx) / (radius * np.cos(np.radians(lat))))
            if mars:
                row = (44 - latitudes) * 128 - 0.5
                col = longitudes * 128 - 0.5
            else:
                row = (south + 1 - latitudes) * 3600
                col = (longitudes - west) * 3600
            values = map_coordinates(raster, [row, col], order=1, output=float,
                                     mode='constant', cval=np.nan)
            if not np.isfinite(values).all() or np.any(values < -16000):
                raise ValueError("DEM contains missing or invalid elevations in this window")
            heights += values
    return heights / len(offsets)**2


def summarize(site, heights, out):
    dy, dx = np.gradient(heights, SPACING)
    slope = np.degrees(np.arctan(np.hypot(dx, dy)))[1:-1, 1:-1]
    span = float(np.ptp(heights))
    relative = (heights - heights.min()) / span
    colors = np.array([[61,39,43], [149,76,55], [243,183,120]])
    shades = np.stack([np.interp(relative, [0,.5,1], channel) for channel in colors.T], axis=-1)
    Image.fromarray(shades.round().astype('uint8')).resize((408,408), Image.Resampling.BILINEAR).save(out / f"{site['id']}.png")
    return dict(site, relief=round(span, 1), median=round(float(np.median(slope)), 2),
                p90=round(float(np.percentile(slope, 90)), 2))


def hgt(path):
    with gzip.open(path, 'rb') as source:
        return np.frombuffer(source.read(), dtype='>i2').reshape(3601, 3601)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('mola')
    parser.add_argument('utah')
    parser.add_argument('atacama')
    args = parser.parse_args()
    dem = np.memmap(args.mola, dtype='>i2', mode='r', shape=(5632, 11520))
    out = Path(__file__).resolve().parents[1] / 'public' / 'terrain'
    out.mkdir(parents=True, exist_ok=True)
    sites = [
        (dict(id='jezero', name='Jezero Crater', planet='Mars', lat=18.45, lon=77.45,
              source='NASA MGS / MOLA MEGDR', url=MOLA), dem, dict(mars=True)),
        (dict(id='utah', name='Hanksville, Utah', planet='Earth', lat=38.40, lon=-110.70,
              source='Mapzen Skadi elevation', url=f'{SKADI}/N38/N38W111.hgt.gz'),
         hgt(args.utah), dict(south=38, west=-111)),
        (dict(id='atacama', name='Atacama Desert, Chile', planet='Earth', lat=-23.62, lon=-68.35,
              source='Mapzen Skadi elevation', url=f'{SKADI}/S24/S24W069.hgt.gz'),
         hgt(args.atacama), dict(south=-24, west=-69)),
    ]
    records = [summarize(site, sample(raster, site['lat'], site['lon'], **kwargs), out)
               for site, raster, kwargs in sites]
    (out / 'sites.json').write_text(json.dumps(records, indent=2) + '\n')


if __name__ == '__main__':
    main()
