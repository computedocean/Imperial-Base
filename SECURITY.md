# Security policy

Imperial Base is a local application. It is designed to run on your own computer and to be reachable only from it.

## Security model

Each item below is enforced in code and covered by the automated tests in `backend/tests/` (see
[docs/TESTING.md](docs/TESTING.md)). Passing tests show these checks behave as described; they are not a security
certification. The limits that remain are listed after the model.

- **Loopback only.** The server binds to `127.0.0.1`. Changing `IMPERIAL_HOST` to another address is not
  supported: every request from a non-loopback address is refused.
- **Every request is checked at the server edge (DNS rebinding).** Before any route runs, every HTTP request and
  WebSocket handshake must have exactly one `Host` header naming `127.0.0.1`, `localhost` or `[::1]` with the port
  the server actually listens on, and a loopback caller. Other names (including ones that resolve to 127.0.0.1),
  other ports, user info, trailing dots and other odd forms are refused. An `Origin`, when sent, must be exactly
  `http://` plus that `Host`. Browsers that mark a request as cross-site or same-site (another port) are refused
  on `/api` and `/ws`. Forwarding headers (`X-Forwarded-Host`, `Forwarded`) are never read, and the start scripts
  run uvicorn with `--no-proxy-headers`. This covers the read-only endpoints (`/api/snapshot`, `/api/events`,
  `/api/agents`, ...) as well as the ones that change state.
- **Development server.** A request whose `Host` names a Vite dev-server port (5273 or 5274) is accepted only if it
  carries the random token that the running Vite server created at start-up. Vite writes that token to
  `<base dir>\dev-proxy\vite-<port>.token` and adds it to the requests it proxies. The port number alone, or a
  page served from that port, earns no trust.
- **State-changing requests.** The order endpoints and `/api/ingest` also need a JSON body (`application/json`) of
  limited size.
- **Minimal capture, with redaction.** The Claude Code hook does not store tool inputs or outputs, file contents,
  full commands or full prompts. It replaces recognisable secrets with `[redacted]` in every text field it writes:
  `KEY=value` and `"key": "value"` pairs with names such as `password`, `token`, `secret`, `api_key` or
  `DB_PASSWORD`, `--password x` style options, `user:password@` in URLs, `Authorization` headers and bearer
  credentials, Stripe `sk_live_` keys, Hugging Face `hf_`, GitLab `glpat-`, GitHub, Slack, AWS, Google and npm tokens,
  JWTs, long hex or random-looking strings, and e-mail addresses. The backend applies the same patterns again to
  every record it accepts, and accepts only an allow-list of fields. If the hook fails, it writes nothing and
  prints nothing.
- **Untrusted paths.** Transcript paths from hook events are checked as text before any filesystem call and read
  only from the Claude Code projects folder (`~/.claude/projects`, or `projects` under `CLAUDE_CONFIG_DIR`) and
  `~/.cursor`; the web server checks URL paths the same way and serves only files inside the built frontend.
  Network shares, device paths and traversal are refused.
- **Bounded resources.** Request bodies, WebSocket messages and connections, and the in-memory agent, task and
  delegation registries all have fixed limits.
- **Stopping the servers.** `stop.cmd` stops a process only if the base recorded it at start-up (process id and
  start time, in `<base dir>\run`). Any other program listening on 8742 or 5273, including other Python or Node
  processes, is left alone.
- **Orders are powerful and off by default.** With `IMPERIAL_ORDERS=1`, an order starts a Claude Code agent with
  `acceptEdits` permissions in its own workspace folder. By default the agent gets two built-in tools,
  `--tools Edit,Write`: it can create and change files but cannot read or search them. `IMPERIAL_ORDERS_READ=1`
  adds Read, Glob and Grep. It never gets a shell, web access, subagents, skills or MCP servers. Several layers
  keep it to its folder:
  - a guard (`backend/app/orders_guard.py`) that Claude Code runs before every tool call. It refuses any path
    outside the workspace, compared case-insensitively on Windows after following links and junctions, and any
    UNC, device or traversal path, any tool not granted, and writing `CLAUDE.md`, `.claude` or `.mcp.json` in any
    letter case;
  - deny rules for the base's code, hook copy, data and settings, your Claude Code configuration folder
    (`CLAUDE_CONFIG_DIR` or `~/.claude`), `~/.claude.json` and common credential files (`~/.ssh`, `~/.aws`,
    `~/.config`, `~/.netrc`, ...);
  - a check of your Claude Code user settings and any managed settings before every launch. Orders stay off if
    those settings allow file tools by rule, add working directories, switch hooks off, make
    `bypassPermissions` the default, cannot be read, or contain a setting the base does not recognise. Only a
    short reason is shown, never the settings' contents;
  - a check that the workspace does not overlap the protected paths and holds no Claude Code project
    configuration (`CLAUDE.md`, `CLAUDE.local.md`, `.claude`, `.mcp.json`);
  - a new settings file for each launch, created exclusively and removed when that agent ends.

### Limits (residual risks)

- **Not an operating-system sandbox.** Every Orders control above is enforced by Claude Code (its tool list,
  permission rules and hooks) or checked by the base before a launch. A bug in Claude Code, or a future version
  that changes how these work, could weaken them.
- **The guard is a hook.** Claude Code lets a tool call through if a hook cannot be run at all, for example if its
  shell cannot start the command. The guard's command is written for a POSIX shell such as Git Bash, which Claude
  Code uses on Windows. The base cannot confirm which shell runs hooks without starting Claude Code. This is why
  reading is off by default: without Read, Glob and Grep, containment of edits also rests on Claude Code's own
  `acceptEdits` rule, which approves edits only inside the working folder and refuses the rest in a headless run.
- **Your own hooks still run** in order agents, as in every session. The base assumes Claude Code applies a hook's
  refusal even when another hook approves the same call.
- **Redaction is pattern matching.** It cannot recognise every secret. An unlabelled password made of ordinary
  words, or a secret in an unusual format, passes through. Session ids, the working-folder path and transcript
  paths are kept as written.
- **Anything an agent reads can steer it.** That includes files in its workspace and the text of your order.
- **Local programs are trusted.** Any program running as your user can read the dev-proxy token and send requests
  to the base, just as it can run Claude Code itself.

See [docs/AGENT_INTEGRATION.md](docs/AGENT_INTEGRATION.md#orders-the-one-command-channel) for the full list of
Orders controls and their limits.

## Reporting a vulnerability

Please report suspected vulnerabilities privately through GitHub:
**Security → Report a vulnerability** on this repository. Do not open a public issue for security problems.

Include what you found, how to reproduce it and what an attacker could do with it. You will get a reply as soon
as possible, and fixes will be credited unless you prefer otherwise.

## Supported versions

Only the latest commit on `main` is supported.
