export const HELP = `mini-cloud — a private cloud for your own machines

USAGE
  mini-cloud <command> [subcommand] [options]

RUNNING THINGS
  serve                        Start the control plane (HTTP API, pub/sub hub, scheduler)
  agent start                  Run a worker agent on this machine
  migrate                      Apply pending database migrations and exit

TASKS
  task list                    List every task at its latest version
  task get <taskId>            Show one task, its schedule and its target agents
  task create                  Define a new task
  task update <taskId>         Write a new version of a task
  task delete <taskId>         Delete a task and all of its versions
  task launch <taskId>         Launch now, on the task's agents or --agent
  task enable <taskId>         Let the scheduler launch this task
  task disable <taskId>        Stop the scheduler launching this task
  task agents <taskId>         Set which agents a task runs on

INSTANCES
  instance list                List launches, newest first
  instance get <instanceId>    Show one launch
  instance events <instanceId> Show a launch's event log
  instance terminate <id>      Ask the agent to stop a running instance

FLEET
  agent list                   List registered agents and their liveness
  agent stop <agentId>         Ask an agent to shut down

VARIABLES
  var list                     Show the fleet-wide \${NAME} substitutions
  var set NAME=value ...       Replace the whole substitution set

PUB/SUB
  pubsub status                Show connected subscribers per topic
  pubsub publish <topic> [json]  Publish one message
  pubsub watch <topic>         Tail a topic until interrupted

COMMON OPTIONS
  --service <url>              Service base URL (env MINI_CLOUD_SERVICE_URL, default http://127.0.0.1:3000)
  --token <token>              Bearer token (env MINI_CLOUD_TOKEN)
  --json                       Print raw JSON instead of a table

TASK CREATE / UPDATE OPTIONS
  --name <name>                Required. Human-readable name
  --type job|service           Default: job. A job runs to completion; a service stays up
  --cmd <command>              Required. Executable or shell command
  --cwd <dir>                  Working directory. Default: the current directory
  --arg <value>                Argument to pass. Repeat for several
  --env KEY=VALUE              Environment variable. Repeat for several
  --stdout <path>              Append stdout here. Default: a per-instance file on the agent
  --stderr <path>              Append stderr here. Default: a per-instance file on the agent
  --description <text>         What this task is for
  jobs:
  --every <30s|5m|2h|1d>       Relaunch on this interval
  --at <iso|epoch|now>         When the first launch happens. Default: now, if --every is set
  services:
  --health-ping <url>          Health-check by polling this URL
  --health-passive <30s>       Health-check by heartbeat from the task at this interval
  --health-period <30s>        How often to poll, for --health-ping

VALUES YOU CAN SUBSTITUTE
  Set fleet-wide values with 'var set', then use \${NAME} in cmd, cwd, args, env or
  stdio paths. Agents additionally resolve \${HOME}, \${HOSTNAME}, \${AGENT_ID},
  \${AGENT_NAME}, \${AGENT_DIR}, \${STDOUT_DIR}, \${STDERR_DIR}, \${INSTANCE_ID} and
  \${TASK_ID} on the machine where the task actually runs.

EXAMPLES
  mini-cloud serve
  mini-cloud agent start --id laptop-1
  mini-cloud task create --name backup --cmd ./backup.sh --cwd ~/scripts --every 1d --at 2026-01-01T03:00:00Z
  mini-cloud task agents 1234567890 --agent laptop-1
  mini-cloud task enable 1234567890
  mini-cloud task launch 1234567890 -- --dry-run
  mini-cloud instance list --task 1234567890
`;
