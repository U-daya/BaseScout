CREATE TABLE IF NOT EXISTS missions (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  report jsonb NOT NULL
);
