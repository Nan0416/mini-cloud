-- Initial mini-cloud schema.
--
-- Tasks are immutable and versioned: `task` holds every version ever written and
-- `task_head` points at the newest. A running instance therefore always resolves the
-- exact definition it was launched from, even after the task is edited.

CREATE TABLE IF NOT EXISTS task (
  task_id         TEXT        NOT NULL,
  version         INTEGER     NOT NULL,
  name            TEXT        NOT NULL,
  description     TEXT,
  type            TEXT        NOT NULL CHECK (type IN ('job', 'service')),
  cmd             TEXT        NOT NULL,
  cwd             TEXT        NOT NULL,
  arguments       JSONB,
  env             JSONB,
  stdout          TEXT,
  stderr          TEXT,
  -- service only
  health_check    JSONB,
  -- job only: relaunch every `duration_ms` starting from `first_launch_at`
  duration_ms     BIGINT,
  first_launch_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, version)
);

CREATE TABLE IF NOT EXISTS task_head (
  task_id    TEXT PRIMARY KEY,
  version    INTEGER     NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (task_id, version) REFERENCES task (task_id, version) ON DELETE CASCADE
);

-- Kept separate from `task` so that pausing a schedule or retargeting agents does
-- not create a new task version.
CREATE TABLE IF NOT EXISTS task_dynamics (
  task_id          TEXT PRIMARY KEY,
  active           BOOLEAN     NOT NULL DEFAULT FALSE,
  target_agent_ids TEXT[]      NOT NULL DEFAULT '{}',
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Agents self-register on their first heartbeat; no config change is needed to add
-- a machine to the fleet.
CREATE TABLE IF NOT EXISTS agent (
  agent_id      TEXT PRIMARY KEY,
  name          TEXT        NOT NULL,
  status        TEXT        NOT NULL CHECK (status IN ('online', 'offline')),
  last_seen_at  TIMESTAMPTZ,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- `status_rank` mirrors TASK_INSTANCE_STATUS_RANK from @mini-cloud/shared. Storing it
-- lets a status update be a single guarded UPDATE (`WHERE status_rank <= $new`), so a
-- late-arriving report can never overwrite a newer one and no read-then-write race
-- exists between concurrent agent reports.
CREATE TABLE IF NOT EXISTS task_instance (
  instance_id  TEXT PRIMARY KEY,
  task_id      TEXT        NOT NULL,
  task_version INTEGER     NOT NULL,
  agent_id     TEXT        NOT NULL,
  pid          INTEGER,
  status       TEXT        NOT NULL,
  status_rank  INTEGER     NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS task_instance_task_idx ON task_instance (task_id, task_version);
CREATE INDEX IF NOT EXISTS task_instance_status_idx ON task_instance (status);
CREATE INDEX IF NOT EXISTS task_instance_updated_idx ON task_instance (updated_at);
CREATE INDEX IF NOT EXISTS task_instance_agent_idx ON task_instance (agent_id, status);

CREATE TABLE IF NOT EXISTS task_event (
  event_id    TEXT PRIMARY KEY,
  instance_id TEXT        NOT NULL REFERENCES task_instance (instance_id) ON DELETE CASCADE,
  source      TEXT        NOT NULL CHECK (source IN ('service', 'agent', 'task')),
  level       TEXT        NOT NULL CHECK (level IN ('success', 'warning', 'error')),
  format      TEXT        NOT NULL CHECK (format IN ('string', 'json')),
  payload     JSONB       NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS task_event_instance_idx ON task_event (instance_id, occurred_at);
CREATE INDEX IF NOT EXISTS task_event_occurred_idx ON task_event (occurred_at);

-- Fleet-wide `${NAME}` substitutions applied to a task before it is dispatched.
CREATE TABLE IF NOT EXISTS replacement_variable (
  name       TEXT PRIMARY KEY,
  value      TEXT        NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
