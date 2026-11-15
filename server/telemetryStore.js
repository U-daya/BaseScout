// Pi telemetry history in Tiger Data (TimescaleDB on PostgreSQL).
// The Cloudflare relay batches every Pi sample to POST /api/telemetry/ingest; samples land in a hypertable
// with compression and retention policies. A real-time continuous aggregate keeps per-minute averages that
// GET /api/telemetry/history serves to the app's charts.

const SETUP = [
  // Required: the raw sample table as a hypertable partitioned by time.
  { required: true, sql: `CREATE TABLE IF NOT EXISTS telemetry (
      time timestamptz NOT NULL,
      temp_c double precision, pressure_hpa double precision,
      light double precision, air_quality double precision, uv double precision,
      joystick_x real, joystick_y real)` },
  { required: true, sql: `SELECT create_hypertable('telemetry', 'time', chunk_time_interval => INTERVAL '1 day', if_not_exists => TRUE)` },
  // Optional: each runs on its own, because TimescaleDB refuses some of these inside a transaction.
  { sql: `ALTER TABLE telemetry SET (timescaledb.compress, timescaledb.compress_orderby = 'time DESC')` },
  { sql: `SELECT add_compression_policy('telemetry', INTERVAL '1 day', if_not_exists => TRUE)` },
  { sql: `SELECT add_retention_policy('telemetry', INTERVAL '30 days', if_not_exists => TRUE)` },
  { sql: `CREATE MATERIALIZED VIEW IF NOT EXISTS telemetry_1m
      WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
      SELECT time_bucket(INTERVAL '1 minute', time) AS bucket,
             avg(temp_c) AS temp_c, avg(pressure_hpa) AS pressure_hpa,
             avg(light) AS light, avg(air_quality) AS air_quality, max(air_quality) AS air_quality_max,
             count(*) AS samples
      FROM telemetry GROUP BY bucket WITH NO DATA` },
  { sql: `SELECT add_continuous_aggregate_policy('telemetry_1m', start_offset => INTERVAL '2 hours',
      end_offset => INTERVAL '1 minute', schedule_interval => INTERVAL '1 minute', if_not_exists => TRUE)` },
];

export async function setupTelemetryStore(db) {
  const state = { ready: false, aggregate: false };
  for (const step of SETUP) {
    try {
      await db.query(step.sql);
      if (step.sql.includes('telemetry_1m') && step.sql.startsWith('CREATE')) state.aggregate = true;
    } catch (error) {
      console.error('Telemetry store setup step failed:', error.message.split('\n')[0]);
      if (step.required) return state;
    }
  }
  state.ready = true;
  return state;
}

const LIMITS = { temp_c: [-60, 100], pressure_hpa: [300, 1200], light: [0, 65535], air_quality: [0, 65535], uv: [0, 100], joystick_x: [-1.5, 1.5], joystick_y: [-1.5, 1.5] };
const FIELDS = Object.keys(LIMITS);
export const MAX_BATCH = 60;

export function cleanSamples(input, now = Date.now()) {
  if (!Array.isArray(input)) return [];
  const out = [];
  for (const s of input.slice(0, MAX_BATCH)) {
    if (!s || typeof s !== 'object') continue;
    const t = typeof s.timestamp === 'string' && s.timestamp.length <= 40 ? Date.parse(s.timestamp) : NaN;
    if (!Number.isFinite(t) || t < now - 86400000 || t > now + 300000) continue;
    const row = { time: new Date(t).toISOString() };
    let any = false;
    for (const f of FIELDS) {
      const v = s[f], [min, max] = LIMITS[f];
      row[f] = typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null;
      if (row[f] !== null && !f.startsWith('joystick')) any = true;
    }
    if (any) out.push(row);
  }
  return out;
}

export async function insertSamples(db, rows) {
  if (!rows.length) return 0;
  const cols = ['time', ...FIELDS];
  const types = ['timestamptz', 'float8', 'float8', 'float8', 'float8', 'float8', 'float4', 'float4'];
  const params = cols.map(c => rows.map(r => r[c]));
  await db.query(
    `INSERT INTO telemetry (${cols.join(', ')}) SELECT * FROM unnest(${types.map((t, i) => `$${i + 1}::${t}[]`).join(', ')})`,
    params);
  return rows.length;
}

const round = (v, d) => v == null ? null : Math.round(Number(v) * 10 ** d) / 10 ** d;

export async function telemetryHistory(db, state, minutes) {
  const source = state.aggregate ? 'telemetry_1m' : null;
  const sql = source
    ? `SELECT bucket, temp_c, pressure_hpa, light, air_quality, air_quality_max, samples FROM telemetry_1m
       WHERE bucket > now() - make_interval(mins => $1) ORDER BY bucket`
    : `SELECT time_bucket(INTERVAL '1 minute', time) AS bucket, avg(temp_c) AS temp_c, avg(pressure_hpa) AS pressure_hpa,
         avg(light) AS light, avg(air_quality) AS air_quality, max(air_quality) AS air_quality_max, count(*) AS samples
       FROM telemetry WHERE time > now() - make_interval(mins => $1) GROUP BY bucket ORDER BY bucket`;
  const [{ rows }, { rows: [stats] }] = await Promise.all([
    db.query(sql, [minutes]),
    db.query(`SELECT approximate_row_count('telemetry') AS total, (SELECT max(time) FROM telemetry) AS latest`),
  ]);
  return {
    minutes,
    source: source ? 'TimescaleDB continuous aggregate (per-minute)' : 'TimescaleDB hypertable',
    total: Number(stats?.total ?? 0),
    latest: stats?.latest ?? null,
    buckets: rows.map(r => ({
      t: r.bucket, temp_c: round(r.temp_c, 2), pressure_hpa: round(r.pressure_hpa, 2),
      light: round(r.light, 0), air_quality: round(r.air_quality, 0), air_quality_max: round(r.air_quality_max, 0), samples: Number(r.samples),
    })),
  };
}
