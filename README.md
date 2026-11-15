# BaseScout

NASA Space Apps prototype. Compare real Earth and Mars elevation windows, then drive a simulated rover to choose between two crew-base pads.

## Teammate handoff

- [Live BaseScout demo](https://basescout.basescout-team.workers.dev/)
- Install Node 24, then run `npm ci` and `npm run dev` from this directory. The keyboard mission and bundled terrain comparison run locally without a database.
- Both simulated mission routes and the terrain comparison were tested. A fresh report was saved on the public site and opened on a phone with all laptop terminals closed.
- Live request path: Cloudflare Worker → Cloudflare Quick Tunnel on Vultr → BaseScout API → TigerData. The API runs as `basescout-api.service` on loopback port 8789. The background tunnel runs as `basescout-demo-tunnel.service`.
- Leave the Vultr instance running for the demo. The Quick Tunnel survives SSH logout. If it stops or the VM reboots, start a new tunnel and update the Worker’s `VULTR_ORIGIN` secret. The browser still uses the same public BaseScout URL.
- Pending work: Gemini mission debrief, physical Pi and joystick validation, SolidWorks GLB export and integration, and clarification of the SpaceX ST item.

### Share on GitHub

Create a private repo named `BaseScout`, upload the contents of this folder, and invite your teammate in the repo settings. Keep the directory structure, including the `public/terrain` assets, `.gitignore`, and the example env files. Use the example files to configure your own local settings. Credentials, deployment secrets, and temporary tunnel URLs belong outside the repository.

## Build order

1. Scaffold React/Vite and render the Three.js field with a six-wheel placeholder rover.
2. Add driving and the two mission branches. Verify both with the Pi unplugged.
3. Bundle real elevation summaries and maps, and rank both Earth candidates.
4. Bring up the Pi WebSocket on the demo LAN. Verify units, joystick directions, stale data, and disconnect behavior.
5. Replace the placeholder with the SolidWorks rover export from Dhruv and Naman. Rehearse both mission outcomes and record a keyboard-only fallback.

## Udaya's handoff

- [ ] **Run it.** Use Node 22.12+ (verified on Node 24). In this directory run `npm ci` and `npm run dev`. Open the localhost URL Vite prints. Run `npm run build` for a production check.
- [ ] **Demo both branches.** Use WASD or the arrows. Pad A sits upper left and starts as the favorite. Drive into its ring and test the soil with **Pass** selected to recommend A. Reset, select **Fail**, drive to A and test again. Follow the active ring to B and test its backup sample to recommend B. The app changes the destination while the operator keeps driving.
- [ ] **Explain the simulation.** The 3D field, pad slopes (A 3.2°, B 5.6°), 8° cutoff, and soil results are demo settings. B's soil always passes in this prototype. The Terrain comparison tab uses measured elevation sources at regional scale. Pi readings are tabletop telemetry and have no effect on the pad decision.
- [ ] **Connect the Pi.** Put the laptop and Pi on the same demo network. Have Vidhyuth run the WebSocket server on a laptop-reachable interface with the path `/telemetry`. Enter the Pi IP and agreed port in **Live Earth demo telemetry**, for example `ws://192.168.1.50:8765/telemetry`. Use `wss://` if hosting the app over HTTPS. Keyboard input overrides the joystick while a drive key is held. Verify the status changes to disconnected when the socket closes and check that the keyboard still works.
- [ ] **Finish next.** Confirm the Pi stream and units below. Check the rover model orientation and framing on the demo laptop. Keep the bundled terrain and keyboard-only route available for presentation.

## Pi contract to confirm with Vidhyuth

Please confirm the host, port, update rate, and sensors for the Pi 5 endpoint. Send a JSON text message per sample on `/telemetry`, with an ISO 8601 timestamp, numeric readings, and `null` for missing values. Can you confirm whether UV is an index or irradiance, whether light is lux or raw counts, and what quantity and units air quality represents? The app expects temperature in °C and pressure in hPa. Joystick axes should be normalized to −1 through +1, centered at zero, with positive X right and positive Y forward. Please confirm both directions on hardware.

```json
{"timestamp":"2026-11-14T23:00:00Z","uv":null,"light":null,"air_quality":null,"temp_c":22.5,"pressure_hpa":1013.2,"joystick_x":0,"joystick_y":0}
```

A 10–20 Hz stream is a starting point for responsive driving. The client applies a 0.12 radial dead zone and stops joystick-driven motion after one second without a valid packet. After two seconds without a sample, the readings clear and the panel shows that the connection has no fresh readings. Use **Connect** to reconnect. Set `VITE_TELEMETRY_URL` in `.env.local` to prefill and connect automatically on startup.

## Rover model swap

Ask Dhruv and Naman for a self-contained `rover.glb` converted from their SolidWorks assembly. Use Y-up and orient the nose toward −Z. Put the file at `public/models/rover.glb`, copy `.env.example` to `.env.local`, uncomment `VITE_ROVER_MODEL_URL`, and restart Vite. The loader centers and scales the model horizontally and sits it on the ground. A missing or failed export leaves the primitive rover visible.

## Terrain data and reproducibility

The bundled maps compare windows centered at 18.45° N, 77.45° E (Jezero), 38.40° N, 110.70° W (Hanksville), and 23.62° S, 68.35° W (Atacama). Each window spans 25 km between the outer sample centers at 500 m spacing. The script uses a local spherical distance approximation, bilinear interpolation on Mars, and sub-sample averaging on Earth. Slope uses centered differences on interior cells. Each displayed map is independently colored by relative elevation.

The ranking uses the mean absolute relative difference from Jezero across window elevation range, median slope, and 90th percentile slope with equal weights. The score applies to these windows and this scale.

- Mars source and label: [NASA PDS MOLA MEGDR](https://pds-geosciences.wustl.edu/missions/mgs/megdr.html), [megt44n000hb.img](https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg128/megt44n000hb.img), [PDS label](https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg128/megt44n000hb.lbl).
- Earth elevation: [Mapzen Skadi](https://www.mapzen.com/blog/terrain-tile-service/), [N38W111](https://s3.amazonaws.com/elevation-tiles-prod/skadi/N38/N38W111.hgt.gz), [S24W069](https://s3.amazonaws.com/elevation-tiles-prod/skadi/S24/S24W069.hgt.gz). Elevation data from NASA SRTM and other open sources via Mapzen.

With NumPy, SciPy, and Pillow installed, run `python scripts/build_terrain.py megt44n000hb.img N38W111.hgt.gz S24W069.hgt.gz`. The generated maps and statistics already ship in `public/terrain`, so the app needs no terrain API key or network connection after installation.

## Mission reports and deployment

**Save mission** appears after the rover has a recommendation. The API reconstructs the simulated test sequence from the Pad A result and saves an immutable report. The resulting `/?mission=<id>` link can be opened in another browser. Share links are public to anyone with the URL and contain only the simulated mission data.

### Test locally

1. Create a Tiger Cloud PostgreSQL service and copy its verified TLS connection URI from the service's Connect panel. Put it in `server/.env` using `server/.env.example` as a template. Use a database role that can create the missions table and read/insert rows. If the service requires a CA file, follow its Connect panel instructions to install the CA on the machine running the backend.
2. Run `npm ci` from the project folder. Run `npm run api` in one terminal and `npm run dev` in another. The API initializes its table at startup, and Vite proxies `/api` to port 8788. Leave `ORIGIN_TOKEN` unset for this loopback-only test.
3. Finish **A fails → B passes** and click **Save mission → Open shareable mission report**. Verify both tests, the two slopes, and the recommendation. Copy the report URL into a new local tab to verify retrieval.

### Deploy with your own infrastructure

1. Transfer the project to the Vultr VM, install Node.js 22.12 or later, and run `npm ci` in the project directory. Create `server/.env` on Vultr with the TigerData URI and a random `ORIGIN_TOKEN`. Run `npm run api` there. The API listens on loopback by default. For the demo, keep the process running in tmux, or configure it as a service if the team already uses one.
2. Give the Vultr VM an HTTPS hostname you control. For example, point a DNS record at Vultr, allow inbound HTTP/HTTPS for certificate issuance and requests, and configure Caddy to proxy that hostname to `127.0.0.1:8788`. Example Caddyfile, after replacing the hostname:

   ```
   api.example.com {
     reverse_proxy 127.0.0.1:8788
   }
   ```

3. From the same Windows project folder you deployed before, run the following. When prompted, enter the origin URL without a path for `VULTR_ORIGIN` (for example, `https://api.example.com`) and the exact same token as the Vultr backend for `ORIGIN_TOKEN`. Keep both the database URI and token out of client code.

   ```cmd
   npm ci
   npm run build
   npx wrangler@latest secret put VULTR_ORIGIN
   npx wrangler@latest secret put ORIGIN_TOKEN
   npx wrangler@latest deploy
   ```

4. On the public Cloudflare URL, finish a mission and save it. Open its report link on a second device. The Worker forwards only the API paths to Vultr over HTTPS. The website assets remain hosted on Cloudflare.
