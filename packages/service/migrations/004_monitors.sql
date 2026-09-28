-- Monitors: a threshold on one statistic of one series, evaluated every minute.
--
-- The definition and the current state share a row, because every evaluation reads
-- both and a state is meaningless without the definition it was judged against. What
-- the state used to be lives in monitor_state_change.

CREATE TABLE IF NOT EXISTS monitor (
  -- The key in the monitor's link, so there is no id beside it and no rename.
  name                TEXT             PRIMARY KEY,
  description         TEXT,
  namespace           TEXT             NOT NULL,
  metric_name         TEXT             NOT NULL,
  dimensions          JSONB            NOT NULL,
  statistic           TEXT             NOT NULL,
  period_ms           BIGINT           NOT NULL CHECK (period_ms > 0),
  evaluation_periods  INTEGER          NOT NULL CHECK (evaluation_periods > 0),
  datapoints_to_alarm INTEGER          NOT NULL,
  comparison          TEXT             NOT NULL CHECK (comparison IN ('GreaterThanThreshold', 'GreaterThanOrEqualToThreshold', 'LessThanThreshold', 'LessThanOrEqualToThreshold')),
  threshold           DOUBLE PRECISION NOT NULL,
  treat_missing_data  TEXT             NOT NULL CHECK (treat_missing_data IN ('missing', 'ignore', 'breaching', 'notBreaching')),
  notify              BOOLEAN          NOT NULL,
  state               TEXT             NOT NULL DEFAULT 'INSUFFICIENT_DATA' CHECK (state IN ('OK', 'ALARM', 'INSUFFICIENT_DATA')),
  state_reason        TEXT             NOT NULL,
  state_changed_at    TIMESTAMPTZ      NOT NULL DEFAULT now(),
  last_evaluated_at   TIMESTAMPTZ,
  -- Bumped by an edit of the definition only, never by an evaluation, so the evaluator
  -- writing every minute cannot make an operator's save conflict.
  version             INTEGER          NOT NULL DEFAULT 1,
  created_at          TIMESTAMPTZ      NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ      NOT NULL DEFAULT now(),
  CHECK (datapoints_to_alarm BETWEEN 1 AND evaluation_periods)
);

-- One row per change of state, the record a notification is sent from. Written in the
-- same transaction as the state it records, so the two cannot disagree.
CREATE TABLE IF NOT EXISTS monitor_state_change (
  change_id    BIGSERIAL        PRIMARY KEY,
  monitor_name TEXT             NOT NULL REFERENCES monitor (name) ON DELETE CASCADE,
  from_state   TEXT             NOT NULL,
  to_state     TEXT             NOT NULL,
  reason       TEXT             NOT NULL,
  -- The periods the decision was made on, and the threshold then: the definition may
  -- have changed by the time someone reads why.
  datapoints   JSONB            NOT NULL,
  threshold    DOUBLE PRECISION NOT NULL,
  changed_at   TIMESTAMPTZ      NOT NULL
);

CREATE INDEX IF NOT EXISTS monitor_state_change_monitor_idx ON monitor_state_change (monitor_name, changed_at DESC);
