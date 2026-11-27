# Claude Code agent integration

Initial and only real-agent integration: **Claude Code 2.1.318** (the installed version) via its **hooks**
mechanism. No paid APIs, no extra subscriptions, no OpenTelemetry collector required.

## Why hooks

Hooks are Claude Code's supported, local, documented way to observe a session: a command receives a JSON
payload on stdin for each lifecycle event. They cover everything Imperial Base needs — sessions, prompts,
every tool call (including tool calls made *inside* subagents, which carry `agent_id`/`agent_type`),
subagent start/stop, turn completion, failures and notifications. Imperial Base neither replaces nor reads any
observability platform you already run.

## Capture: `hooks/imperial-hook.js`

Registered for: `SessionStart, SessionEnd, UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure,
SubagentStart, SubagentStop, Stop, StopFailure, Notification` (timeout 5 s).

Behaviour (covered by tests in `backend/tests/test_backend.py` and `test_security_medium.py`):

* exits 0 always, hard 1.5 s ceiling, writes nothing to stdout (stdout of some hooks is injected into context);
  on any failure (bad JSON, for example) it writes nothing at all and prints nothing;
* **no network**; appends one JSON line to `%USERPROFILE%\.imperial-base\spool\events.jsonl`;
* does not store tool inputs or outputs, file contents, full commands or full prompts. Instead:
  * file tools → basename only (`main.py`);
  * Bash/PowerShell → the human-written `description`, else only the first word of the command;
  * WebFetch → host name only; WebSearch/Glob → short redacted query/pattern;
  * Agent/Task → `description` and `subagent_type` (not the delegated prompt);
  * prompts → first 160 characters, redacted; summaries → 240 characters, redacted;
* redacts every text field it writes except the session and tool-call ids and the Claude Code paths (`cwd`,
  `transcript_path`). The patterns cover `KEY=value`, `KEY: value` and `"key": "value"` pairs whose name ends in a
  secret word (`password`, `passwd`, `pwd`, `pass`, `token`, `secret`, `api_key`, `access_key`, `private_key`,
  `client_secret`, `auth`, `credentials`, `cookie`, with any prefix such as `DB_` or `ANTHROPIC_`, any letter
  case); `--password x`, `--token x`, `--api-key x` style options; `user:password@` in URLs; `Authorization` /
  `Proxy-Authorization` headers and bare `Bearer` / `Basic` credentials; Stripe (`sk_live_`, `sk_test_`,
  `whsec_`), Anthropic/OpenAI (`sk-`), GitHub, GitLab (`glpat-`), Hugging Face (`hf_`), Slack, AWS, Google and npm
  tokens; JWTs; hex strings of 32+ characters; other strings of 40+ letters, digits and `+/_-`; and e-mail
  addresses. Running it twice changes nothing. The backend applies the same patterns (`backend/app/redact.py`)
  to every record it accepts. Pattern matching cannot recognise every secret: an unlabelled password made of
  ordinary words passes;
* records the *names* (not values) of the top-level payload keys, as runtime schema evidence (`/api/schema`).

## Install

`python scripts\install_hooks.py` — copies the hook to `~/.imperial-base/hooks/imperial-hook.js` and registers
that copy (so nothing that can edit the checkout can change what every session runs); additive, idempotent, backs
up `settings.json` first, moves older entries that pointed into the checkout, refuses unknown options.
`--status`, `--uninstall` available. Hooks from other tools are preserved.

Per-session alternative without touching global settings (used for this project's validation runs):

```bat
claude -p "…" --settings C:\path\imperial-settings.json
```

where the file contains a `{"hooks": {...}}` block with the same command for each event.

## Lifecycle → state mapping (`backend/app/state.py`)

| Hook event | Effect |
|---|---|
| SessionStart | main agent `active` (identity `session:<session_id>`) |
| UserPromptSubmit | `working`, assignment = prompt excerpt, opens an **ORDERS** task. Prompts beginning `<agent-message`, `<task-notification` or `<system-reminder` are injected background-agent reports: they open a **REPORT** task and do *not* overwrite the assignment |
| PreToolUse | `working`, active tool + target; for `Agent`/`Task`: `delegating`, queues a pending delegation (type + description) |
| PostToolUse / PostToolUseFailure | clears the active tool; failures increment errors and keep the last error |
| SubagentStart | creates the subagent (`agent:<agent_id>`), links it to the parent and to the oldest pending delegation of the same `subagent_type` (SubagentStart carries no `tool_use_id`), opens a **DELEGATION** task |
| SubagentStop | subagent `completed`, completion summary, token usage from `agent_transcript_path` |
| Stop | main agent `idle` (turn complete — awaiting the Commander), closes the task, token usage from `transcript_path` |
| StopFailure | `failed` + error |
| Notification | `permission_prompt` → `waiting`; `idle_prompt` → `idle` |
| SessionEnd | `disconnected`; non-terminal subagents also `disconnected` ("parent session ended before a completion event was received") |

Tool calls fired inside a subagent carry `agent_id`, so they are attributed to the subagent, not the parent.

**Runtime finding (validated):** in this Claude Code version the `Agent` tool returns immediately and the
subagent runs in the background. The parent's `PostToolUse(Agent)` therefore arrives *before* the subagent's
work, and the parent may reach `Stop` while the child is still active; the subagent's report is later injected
as a new prompt turn. The reducer and UI reflect exactly that ordering.

**No fabrication rules:** status only changes on events. If a non-idle agent has no event for 15 minutes
(`IMPERIAL_STALE_AFTER`), the API marks it `stale`, `activity_known: false`, and the activity reads
"Unknown — last confirmed event: X". Model id is shown only once it appears in transcript usage; tokens only
after a turn completes ("available after the turn completes" before that).

## Agent identity, roles and departments

Callsigns are deterministic from the agent id (e.g. *Cmdr. Ravik-64*, *Lt. Krell-30*) so the same agent always
has the same name. Role/department by `agent_type`:

| agent_type contains | Role | Department |
|---|---|---|
| (main session) | Lead Developer | Engineering |
| review, verif, security, audit, lint | Code Reviewer | Security |
| test, qa | Testing Specialist | Engineering (test labs) |
| plan, architect, orchestr, design | Architect | Operations |
| doc, writer | Documentation Specialist | Intelligence |
| explore, research, search, guide, fetch, ingest, recon | Research Specialist | Intelligence |
| model, eval, ml, ai- | AI Research Specialist | AI Research Labs |
| general-purpose, claude, fork, (empty) | Engineering Specialist | Engineering |
| anything else | "<Type> Specialist" | Engineering |

## Physical representation (`frontend/src/agents/actors.ts`)

* New agent → body appears at its department's entry and walks to a station; agents already on duty when the
  page loads start at their post.
* Station chosen from the **real active tool**: Bash → terminals/consoles/labs; Read/Grep/Glob → records archive
  or console; Edit/Write → development consoles; WebFetch/WebSearch → terminals/archive; Agent/Task (and
  `delegating`) → holotable/briefing table, with a *talk* animation.
* `waiting` → stays at the station, idle pose; `idle`/`completed`/`stale` → lounge area;
  `completed` subagents remain visible 5 minutes, then leave; `disconnected` → walks out after the event.
* Delegation: a purple arc with a travelling data packet links parent and child (across buildings it arcs over
  the base and is visible from outside); dashed and dim once the child is done.
* Exterior: each building shows a beacon "N LIVE AGENTS" with one status pip per agent.

## Orders (the one command channel)

Sessions started elsewhere are observed only; nothing is ever sent to them. The base can command only the agents
it starts itself, from the **Orders** chat (`backend/app/orders.py`):

* off unless `IMPERIAL_ORDERS=1`; while off, `GET /api/commands` lists nothing and no route starts a process;
* each conversation runs the installed `claude` CLI headless (`claude -p`, resumed for follow-ups) in one fixed
  workspace folder (`IMPERIAL_ORDERS_CWD`, default `~/.imperial-base/orders-workspace`); the chat cannot choose
  another;
* **tool allowlist:** `--tools Edit,Write` is the complete set of built-in tools the agent gets by default: it can
  create and change files but not read or search them. `IMPERIAL_ORDERS_READ=1` makes it
  `--tools Read,Edit,Write,Glob,Grep`. Reading is opt-in because its containment rests on the guard hook below,
  and Claude Code lets a tool call through when a hook cannot be run at all. Everything else is always left out:
  shells and other command or code tools (Bash, PowerShell, Monitor, Workflow, LSP), web and messaging tools
  (WebFetch, WebSearch, SendMessage, PushNotification, ...), subagents and skills (Agent, Skill), scheduling
  (Cron*, RemoteTrigger), ToolSearch, NotebookEdit and TodoWrite. `--strict-mcp-config` loads no MCP servers and
  `--disallowedTools mcp__*` removes any MCP tool that still appears;
* permission mode `acceptEdits`: file edits inside the workspace go through without asking. Edits anywhere else
  need approval, which a headless run cannot get. The base keeps orders off if your settings could grant that
  approval by rule (see below);
* **workspace guard** (`backend/app/orders_guard.py`), installed by `--settings` as a `PreToolUse` hook for every
  tool. It is a standalone script run with the base's own Python (`python -I`), so nothing in the workspace can
  change what it imports. It exits 2 (Claude Code then blocks the call) unless:
  * the tool is one the base granted (`Edit`/`Write`, or all five with read access);
  * `file_path` (Read, Edit, Write) and `path` (Glob, Grep) name a plain local path inside the workspace. The text
    is checked first: UNC and device paths (`\\server\share`, `\\?\`, `\\.\`), drive-relative paths, alternate
    data streams, reserved device names, `..`, `~` and control characters are refused before any filesystem call.
    The path is then resolved through symbolic links, junctions and short names and must still lie inside the
    workspace. On Windows the comparison ignores letter case and slash direction. A sibling sharing a name prefix
    (`orders-workspace2`) is outside;
  * Glob patterns and Grep `glob` filters are relative, with no `..`, drive, leading slash or `~`;
  * Edit and Write do not create or change `CLAUDE.md`, `CLAUDE.local.md`, `.claude` or `.mcp.json` anywhere in
    the workspace, in any letter case.

  Anything unexpected (bad input, an exception) is refused, and the reason given never repeats the path. The hook
  command is an absolute interpreter path with plain arguments, without quotes. It is written for a POSIX shell
  such as Git Bash, which Claude Code uses on Windows. If any of its paths would need quoting (spaces, shell
  characters), orders stay off;
* `--settings` also sets `disableAllHooks: false` and adds deny rules, which win over allow rules from every other
  settings file:
  * Read and Edit denied for the base's checkout, the hook copy, the spool folder, the database and its SQLite
    `-wal`, `-shm` and `-journal` files, the agents' settings folder, the base's process records and dev-proxy
    tokens, the **Claude Code configuration folder** (`CLAUDE_CONFIG_DIR` when set, otherwise `~/.claude`:
    settings and their hooks, credentials, agents, commands, skills, plugins, transcripts), **`~/.claude.json`**
    and common credential locations in your profile (`.ssh`, `.aws`, `.azure`, `.kube`, `.docker`, `.gnupg`,
    `.config`, `.netrc`, `.npmrc`, `.pypirc`, `.git-credentials`, `.gitconfig`). Each path is denied both exactly
    and with `/**`;
  * Edit denied for `CLAUDE.md`, `CLAUDE.local.md`, `.claude` and `.mcp.json` anywhere in the workspace;
  * the dangerous tools denied by name (Bash, PowerShell, Monitor, WebFetch, WebSearch, Agent, Skill, Workflow), and
    without read access Read, Glob and Grep too, as a second layer behind `--tools`;
* **one settings file per launch.** Each launch writes its `--settings` file under
  `<base dir>\orders-settings\` with a new, unique name. The file is created exclusively and is readable by your
  user only where the system supports that. It is removed once that agent's process has ended, whether it
  finished, failed, was stopped or the base shut down, and not before, since Claude Code may read its settings
  again while it runs. Concurrent launches never share or remove each other's files;
* `--setting-sources user`: the workspace's project and local settings are not loaded;
* **your settings are checked first.** Before reporting orders as available and again right before each launch,
  the base reads your user settings (`settings.json` in `CLAUDE_CONFIG_DIR`, or `~/.claude`) and any managed
  settings file. Orders stay off, with a short reason and never the settings' contents, if any of them:
  * allows a file tool by rule (`Read`, `Edit`, `Write`, `Glob`, `Grep`, `MultiEdit`, `NotebookEdit`, in any
    letter case, with or without a path), or allows `*`. Allow rules for other tools, which order agents do not
    have, are fine. So are `mcp__` rules, since no MCP servers load. A matching deny rule does not make a file-tool
    allow rule acceptable: the base does not try to merge rules itself;
  * adds working directories (`permissions.additionalDirectories`), where edits would be approved too;
  * switches hooks off (`disableAllHooks`) or allows only managed hooks (`allowManagedHooksOnly`), which would
    switch the guard off;
  * makes `bypassPermissions` the default mode;
  * cannot be read or is not valid JSON;
  * contains a top-level setting or a `permissions` entry the base does not recognise (it cannot tell what that
    would do). Deny and ask rules, hooks, plugins, model, theme, environment variables and other display or login
    settings are accepted;
* **start-up refusal.** The base refuses to start an agent (checked for `GET /api/orders` and again right before
  each process starts) when:
  * the workspace overlaps any protected path above, in either direction (for example a workspace inside
    `~/.claude`, or a workspace that contains it, such as your home folder);
  * the workspace holds Claude Code project configuration at its top level, in any letter case: `CLAUDE.md`,
    `CLAUDE.local.md`, `.mcp.json`, or a non-empty `.claude` folder (settings, agents, commands, skills, hooks,
    rules) or a file of that name;
  * `CLAUDE_CONFIG_DIR` (or another protected path) is not absolute, since the agent would resolve it against its
    own working folder;
  * your settings fail the check above, the `claude` command is not found, or the guard cannot be installed;
* **inherited from your user settings.** Order agents load your user-level Claude Code settings on purpose, so
  the base's hook reports them. That means your user hooks run (with your permissions, outside every tool
  rule), your enabled plugins load, and your user `CLAUDE.md` is read. Managed (policy) settings apply as usual;
* up to four agents work at once; the base keeps 30 conversations in memory, not in its database (Claude Code
  keeps its own session transcript as usual);
* the agent's own hook events make it appear in the world like any other agent.

**Limits.** These are Claude Code controls, not an operating-system sandbox, and the base relies on the CLI to
enforce them:

* **the guard is a hook.** Claude Code lets a tool call through if a hook cannot be run at all (an interpreter that
  will not start, or a shell that cannot run the command). The base checks before each launch that the interpreter
  and the guard exist and that the command needs no quoting. It cannot confirm, without starting Claude Code,
  which shell runs hooks. That is why Read, Glob and Grep are off by default. Without them, edits are also held
  to the workspace by `acceptEdits` itself plus the settings check above. With `IMPERIAL_ORDERS_READ=1`, reading
  outside the workspace is refused only by the guard and the deny rules;
* **deny rules are matched as text.** The docs do not say whether path rules ignore letter case on Windows. Rules
  are written in the on-disk case (drive letter lower-case, as Claude Code compares paths), so a differently-cased
  path could slip past a deny rule if matching is case-sensitive. The guard compares without regard to case and
  refuses such paths. Tests show both the gap a case-sensitive matcher would leave and the guard closing it;
* **hook precedence.** Your own `PreToolUse` hooks still run. The base assumes Claude Code blocks a call when any
  hook refuses it, even if another hook approves it;
* prompt injection from anything the agent reads (its workspace, the order text) can steer it within the limits
  above;
* headless runs silently ignore a settings file that fails validation. If that ever happened to the `--settings`
  file, the guard and the deny rules would be lost, but `--tools`, `--strict-mcp-config`, `--disallowedTools` and
  `acceptEdits` are command-line flags and would still apply;
* only the top level of the workspace is checked at start-up. `CLAUDE.md` files in subfolders are read when the
  agent works there; the guard and deny rules stop agents writing them, but the start-up check does not look for
  them;
* `CLAUDE.md` files in folders above the workspace (for example your home folder) are your own and are not checked;
* settings files left behind by a crash of the base itself (not of an agent) stay in `orders-settings\`. They hold
  only deny rules and the guard command. The base does not sweep the folder, because another instance of the base
  sharing the folder may be using them;
* there is no time limit on a turn; the Commander stops a long-running agent from the chat.

Not checked against a live agent: these flags, rules and the guard hook are covered by unit tests with the process
mocked. The guard script itself is run as a separate process in the tests, including through Git Bash when it is
installed. No real order agent was started to confirm how the installed CLI applies them.

## Other agent systems

Only Claude Code (and Cursor, through the same hook) is integrated. A read-only adapter for another system could append records in the
same sanitised schema to the spool; the engine would ingest them unchanged.
