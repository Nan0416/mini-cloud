-- Notifiers: somewhere a message can be sent, and which of them each monitor sends to.

CREATE TABLE IF NOT EXISTS notifier (
  -- Assigned by the service, so the name is free to change without breaking what refers to it.
  notifier_id TEXT        PRIMARY KEY,
  name        TEXT        NOT NULL UNIQUE,
  description TEXT,
  type        TEXT        NOT NULL CHECK (type IN ('discord')),
  -- What the API shows, such as a Discord channel's name and its webhook's id.
  settings    JSONB       NOT NULL,
  -- What it must never show, such as the webhook URL, which anyone holding can post with.
  -- A column of its own so no query reaches it by accident.
  secrets     JSONB       NOT NULL,
  version     INTEGER     NOT NULL DEFAULT 1,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RESTRICT, so a notifier a monitor still sends to cannot be deleted out from under it.
CREATE TABLE IF NOT EXISTS monitor_notifier (
  monitor_name  TEXT NOT NULL REFERENCES monitor (name) ON DELETE CASCADE,
  notifier_id   TEXT NOT NULL REFERENCES notifier (notifier_id) ON DELETE RESTRICT,
  PRIMARY KEY (monitor_name, notifier_id)
);

CREATE INDEX IF NOT EXISTS monitor_notifier_notifier_idx ON monitor_notifier (notifier_id);

-- The default fills in the monitors that already exist and is then dropped, so every
-- later write has to say what it means.
ALTER TABLE monitor ADD COLUMN IF NOT EXISTS severity INTEGER NOT NULL DEFAULT 3 CHECK (severity BETWEEN 1 AND 5);
ALTER TABLE monitor ALTER COLUMN severity DROP DEFAULT;
