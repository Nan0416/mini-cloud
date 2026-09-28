-- Dashboards: named collections of metric graphs.
--
-- One row per dashboard, with its widgets as a document. Widgets are only ever read and
-- written together, and a widget's queries are the same JSON a graph link carries, so a
-- table per widget and per query would buy joins and nothing a reader needs.

CREATE TABLE IF NOT EXISTS dashboard (
  -- The key in the dashboard's link, so there is no id beside it and no rename.
  name              TEXT        PRIMARY KEY,
  widgets           JSONB       NOT NULL,
  default_range     JSONB,
  default_period_ms BIGINT,
  -- Compared on every update, so two tabs saving the same dashboard conflict rather
  -- than the second silently dropping what the first added.
  version           INTEGER     NOT NULL DEFAULT 1,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
