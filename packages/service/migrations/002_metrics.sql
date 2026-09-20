-- Metrics storage.
--
-- Agents report one row per metric, per dimension set, per minute, and the ingest path
-- rolls each of those into an hour and a day bucket as it lands. Rolling up on write
-- rather than in a scheduled job is what lets data that arrives late — a machine that
-- was offline, or simply slower than its peers — still reach every resolution.
--
-- Several agents report into the same series, in no particular order. Every column here
-- merges commutatively (counts and sums add, min and max take extremes, histograms add
-- per value), so the row two agents produce is the same whichever arrives first.

CREATE TABLE IF NOT EXISTS metric_datum (
  namespace       TEXT             NOT NULL,
  metric_name     TEXT             NOT NULL,
  -- The canonical form of `dimensions`, from hashDimensions() in @mini-cloud/shared.
  -- Stored rather than derived because it is the series identity a query looks up.
  dimensions_hash TEXT             NOT NULL,
  dimensions      JSONB            NOT NULL,
  resolution      TEXT             NOT NULL CHECK (resolution IN ('1m', '1h', '1d')),
  bucket_start    TIMESTAMPTZ      NOT NULL,
  unit            TEXT             NOT NULL,
  sample_count    BIGINT           NOT NULL,
  -- Spelled out rather than `sum`/`min`/`max`, which read as aggregate calls in the
  -- queries that then aggregate them.
  sum_value       DOUBLE PRECISION NOT NULL,
  min_value       DOUBLE PRECISION NOT NULL,
  max_value       DOUBLE PRECISION NOT NULL,
  -- Value-to-count pairs, and only at '1m'. Percentiles need a distribution, and an
  -- hour's percentile derived from sixty minutes' percentiles would be a number with
  -- no meaning. So percentiles are exact inside raw retention and refused outside it,
  -- rather than quietly approximated.
  histogram       JSONB,
  updated_at      TIMESTAMPTZ      NOT NULL DEFAULT now(),
  PRIMARY KEY (resolution, bucket_start, namespace, metric_name, dimensions_hash)
) PARTITION BY LIST (resolution);

-- Partitioned by resolution first, then by time within each resolution.
--
-- The nesting is what makes retention a DROP rather than a DELETE: raw minutes are
-- worth keeping for a fortnight and daily rollups for years, and with a single level
-- both would share a partition, so expiring the minutes would take the rollups with
-- them. Leaf partitions are created on demand by MetricPartitionManager, in whatever
-- width suits the resolution: a day for '1m', a month for '1h', a year for '1d'.
CREATE TABLE IF NOT EXISTS metric_datum_1m PARTITION OF metric_datum FOR VALUES IN ('1m') PARTITION BY RANGE (bucket_start);
CREATE TABLE IF NOT EXISTS metric_datum_1h PARTITION OF metric_datum FOR VALUES IN ('1h') PARTITION BY RANGE (bucket_start);
CREATE TABLE IF NOT EXISTS metric_datum_1d PARTITION OF metric_datum FOR VALUES IN ('1d') PARTITION BY RANGE (bucket_start);

-- Every query names a series and a time range, in that order.
CREATE INDEX IF NOT EXISTS metric_datum_series_idx ON metric_datum (namespace, metric_name, dimensions_hash, resolution, bucket_start);

-- What exists, for the console's pickers, so listing namespaces never scans the data.
--
-- A row per dimension *set* rather than one row per metric accumulating every value
-- ever seen: the latter grows without bound for a high-cardinality dimension and has
-- to be pruned by hand.
CREATE TABLE IF NOT EXISTS metric_series (
  namespace       TEXT        NOT NULL,
  metric_name     TEXT        NOT NULL,
  dimensions_hash TEXT        NOT NULL,
  dimensions      JSONB       NOT NULL,
  unit            TEXT        NOT NULL,
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (namespace, metric_name, dimensions_hash)
);

CREATE INDEX IF NOT EXISTS metric_series_namespace_idx ON metric_series (namespace, metric_name);
CREATE INDEX IF NOT EXISTS metric_series_last_seen_idx ON metric_series (last_seen_at);

-- One row per batch an agent has delivered, which is what makes ingest exactly-once.
--
-- The merge above is additive, so a batch applied twice would count twice. An agent
-- that cannot tell whether its post arrived resends the same batch under the same id;
-- this row is inserted in the same transaction as the data, so the replay finds it and
-- does nothing.
CREATE TABLE IF NOT EXISTS metric_ingest_batch (
  batch_id    TEXT PRIMARY KEY,
  agent_id    TEXT        NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS metric_ingest_batch_accepted_idx ON metric_ingest_batch (accepted_at);

-- Adds two histograms together, per value.
--
-- In SQL rather than in the DAO so that the whole upsert stays one statement: reading
-- a histogram, merging it in TypeScript and writing it back would open a window for a
-- concurrent agent's write to be lost.
CREATE OR REPLACE FUNCTION metric_histogram_merge(a JSONB, b JSONB) RETURNS JSONB AS $$
  SELECT COALESCE(jsonb_object_agg(key, total), '{}'::jsonb)
  FROM (
    SELECT key, SUM(value::numeric) AS total
    FROM (
      SELECT * FROM jsonb_each_text(COALESCE(a, '{}'::jsonb))
      UNION ALL
      SELECT * FROM jsonb_each_text(COALESCE(b, '{}'::jsonb))
    ) pairs
    GROUP BY key
  ) merged;
$$ LANGUAGE SQL IMMUTABLE;
