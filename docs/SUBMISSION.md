# Knowwhere: Space Apps submission kit

Copy-paste material for the NASA Space Apps Challenge 2026 project page (Team T34, New York City).
Numbers below come straight from `public/terrain/sites.json` and the app; re-check them if the data changes.

- **Live demo:** https://knowwhere.nyc (backup: https://basescout.basescout-team.workers.dev/)
- **Code:** https://github.com/U-daya/KnowWhere
- **Challenge:** Identify Earth locations that analog the permanent Moon base locations and Mars

---

## 1. High-level summary (short field)

Knowwhere finds the places on Earth whose terrain best matches where we plan to build on the Moon and Mars, then lets you rehearse choosing the base site there. It compares NASA laser-altimeter elevation data for Shackleton crater rim and Malapert Massif (Moon) and Jezero Crater (Mars) with nine real Earth analog sites, using one formula on a common 25 × 25 km, 500 m grid. The ranking matches real NASA practice: Mauna Kea, where NASA has field-tested lunar resource equipment, comes out as the closest Moon twin; Askja, where Apollo astronauts trained, ties as the closest Mars twin. A rover simulation and a Raspberry Pi field kit then rehearse the next step: testing two candidate landing pads on real measured slopes.

## 2. Project details (long field)

### What it does

1. **Find the Earth twin.** Pick a permanent-base target: Jezero Crater (Mars), Shackleton crater rim or Malapert Massif (Moon). Knowwhere ranks nine real Earth analog sites by terrain similarity and shows each one in 3D with a score breakdown.
2. **Rehearse the landing.** At the chosen Earth twin, a rover drives to two candidate pads. Each pad's slope is measured from that site's real elevation data; the soil test is simulated. Fixed rules pick the pad (slope ≤ 8° and soil pass), so the result is reproducible.
3. **Report.** Each mission saves an immutable, shareable report with the test sequence, live field telemetry from the Raspberry Pi, and a plain-English debrief written by Google Gemini.

### How the terrain match works

- Every site is cut to the same 25 × 25 km window and resampled to a 500 m grid.
- Three numbers describe each window: **relief** (elevation range), **median slope**, and **steep slope** (90th-percentile slope).
- Terrain distance = the average of the three relative differences from the target. Lower is closer.
- Moon targets use NASA LRO LOLA polar topography (LDEM_80S_80M). Mars uses NASA MGS MOLA (MEGDR). Earth sites use Mapzen Terrain Tiles on AWS Open Data, which are mainly NASA SRTM; Askja, Holuhraun and Devon Island lie north of SRTM's 60° N limit and come from the other elevation sources Mapzen merges.

### Results

| Target | Closest Earth twins (terrain distance, lower is closer) |
|---|---|
| Jezero Crater, Mars | Askja caldera 0.28 · Dumont Dunes 0.28 · Holuhraun 0.42 · Hanksville 0.47 |
| Shackleton crater rim, Moon | Mauna Kea 0.46 · Askja caldera 0.81 · Dumont Dunes 0.82 |
| Malapert Massif, Moon | Mauna Kea 0.41 · Askja caldera 0.79 · Dumont Dunes 0.80 |

**Why we trust it:** the ranking agrees with where NASA has actually trained and tested. Apollo astronauts trained in geology at Askja; NASA has field-tested lunar resource equipment on Mauna Kea; JPL has driven test rovers at Dumont Dunes. **Honest limit:** the lunar south pole is far steeper than any of our Earth sites, so even Mauna Kea is a loose Moon match. This is a regional terrain comparison; it cannot judge wheel-scale rocks or real soil.

### Hardware

A Raspberry Pi 5 field kit (Grove Base Hat with joystick, light and air-quality sensors, a DPS310 barometer, and an RGB LCD used as a status light) drives the rover and streams live readings to the public website from any network, through a Cloudflare Durable Object relay at about 14 samples per second. Readings at save time are stored in the mission report.

### SMS alerts

When a mission is saved, the Vultr API sends a Twilio SMS with the result and a link to the report, for example: "Knowwhere mission saved: Pad A soil 42, Pad B soil 18. Recommend Pad A. https://knowwhere.nyc/app?mission=…". The feature is built and was tested end to end on a Twilio trial account. Trial accounts only allow Twilio's pre-defined template text to verified numbers, so during judging the alert arrives as that template. The full custom message is sent automatically once the account is upgraded and US A2P 10DLC registration is approved, with no code change.

### Benefits and intended impact

Analog sites are expensive to reach and choose. Knowwhere gives mission planners, educators and students a transparent, reproducible way to pick the Earth site that best stands in for a specific Moon or Mars base location, and to rehearse the site-selection steps before anyone travels there.

### Tools and technologies

React, Vite and three.js; Python (NumPy) for the elevation pipeline; Cloudflare Workers and Durable Objects (hosting, API proxy, live telemetry relay); a Vultr VM running the Node.js mission API; TigerData PostgreSQL for reports; Google Gemini for debriefs; Twilio SMS alerts; Raspberry Pi 5 with Grove sensors.

### Use of artificial intelligence

- **In the product:** Google Gemini writes a two-sentence explanation of each saved mission. It only explains; fixed rules make the decision, and a rule-based debrief is used if Gemini is unavailable.
- **In development:** we used an AI coding assistant (Anthropic's Claude) to help write and review code and documentation. All terrain numbers come from deterministic code run on the cited NASA and open elevation datasets. No AI-generated images, video or audio are used; the rover model is NASA's.

## 3. 30-second demo video script

| Time | On screen | Voice-over |
|---|---|---|
| 0–4 s | Landing page: the particle planet, title "Where do we build on the Moon and Mars?" | "NASA is choosing where to build on the Moon and Mars. Where on Earth do we practise?" |
| 4–10 s | Scroll: particles morph from Jezero into Askja, score 0.28 | "Knowwhere compares NASA elevation data for each base site with nine real places on Earth." |
| 10–15 s | Shackleton morphs into Mauna Kea, score 0.46 | "For the lunar south pole, Mauna Kea wins: exactly where NASA has tested lunar equipment." |
| 15–24 s | App: rover drives into Pad A with the Pi joystick in hand; LCD glows green; Test soil | "Then we rehearse: a rover, driven by our Raspberry Pi field kit, tests two landing pads on real measured slopes." |
| 24–30 s | Report page: "Recommend Pad A", Gemini debrief, phone buzzes with the SMS | "One saved report, one decision. Knowwhere: find the twin, then rehearse the landing." |

## 4. Seven-slide outline

1. **Title:** Knowwhere. Find the Earth twin of a Moon or Mars base site, then rehearse the landing. Team T34, NYC, live link and QR code.
2. **Problem:** Artemis and Mars missions need practice sites on Earth, but analogs are usually picked by experience, not by measured terrain match.
3. **Approach:** NASA LOLA (Moon) + MOLA (Mars) + Earth elevation, same 25 km window and 500 m grid, three metrics, one distance formula.
4. **Results:** the twins table above, plus the point that it agrees with real NASA training sites (Askja, Mauna Kea, Dumont Dunes), and the honest limit.
5. **Rehearsal:** rover mission screenshot: real pad slopes, simulated soil, fixed rule (≤ 8° and soil pass), saved report with Gemini debrief.
6. **Hardware and stack:** Pi 5 kit photo; architecture: Cloudflare Workers + Durable Object relay, Vultr API, TigerData Postgres, Gemini, Twilio.
7. **Impact and next steps:** any-location scoring, rock-scale data (e.g. HiRISE and LROC NAC), more targets; thank-you and links.

## 5. References

**NASA data**

- NASA LRO Lunar Orbiter Laser Altimeter (LOLA), polar DEM LDEM_80S_80M: https://imbrium.mit.edu/DATA/LOLA_GDR/POLAR/IMG/LDEM_80S_80M.IMG (PDS Geosciences Node)
- NASA MGS Mars Orbiter Laser Altimeter (MOLA) MEGDR, tile megt44n000hb: https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg128/megt44n000hb.img
- NASA Shuttle Radar Topography Mission (SRTM), via Mapzen Terrain Tiles on AWS Open Data (Skadi tiles): https://registry.opendata.aws/terrain-tiles/
- Perseverance rover 3D model: NASA/JPL-Caltech, NASA 3D Resources

**Other resources**

- Poly Haven, "Goegap" HDRI (CC0): https://polyhaven.com/a/goegap
- three.js (MIT), React (MIT), Vite (MIT), meshoptimizer and gltf-transform (MIT)
- Cloudflare Workers and Durable Objects; Vultr; TigerData (PostgreSQL); Google Gemini API; Twilio Programmable Messaging
- Seeed Studio Grove sensors and Grove Base Hat for Raspberry Pi; Infineon DPS310 barometer

**Analog-site background** (for the "why we trust it" claims; add the exact pages you cite)

- Apollo geology training in Iceland, including Askja (1965, 1967)
- NASA lunar in-situ resource utilization field tests on Mauna Kea, Hawaii (2008, 2010)
- JPL rover testing at Dumont Dunes, California
- NASA Artemis III candidate landing regions near the lunar south pole (including Malapert Massif)
