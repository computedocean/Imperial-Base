# Security policy

Imperial Base is a local application. It is designed to run on your own computer and to be reachable only from it.

## Security model

- **Loopback only.** The server binds to `127.0.0.1`. Changing `IMPERIAL_HOST` to another address exposes the
  base to your network and is not supported.
- **Cross-site protection.** The order endpoints and `/api/ingest` require a loopback caller, a loopback `Host`
  header, an `Origin` (when the browser sends one) that is exactly the base's own page or the Vite dev server, and a
  JSON body of limited size. The WebSocket refuses pages from
  any other origin, and only loopback connections receive order conversations.
- **Minimal capture.** The Claude Code hook never stores tool inputs or outputs, file contents, full commands or
  full prompts, and redacts secrets before writing. The backend accepts only an allow-list of fields.
- **Untrusted paths.** Transcript paths from hook events are checked as text before any filesystem call and read
  only from `~/.claude/projects` and `~/.cursor`; the web server checks URL paths the same way and serves only
  files inside the built frontend. Network shares, device paths and traversal are refused.
- **Orders are powerful and off by default.** With `IMPERIAL_ORDERS=1`, an order starts a Claude Code agent with
  `acceptEdits` permissions in its own workspace folder, which may not overlap the base's code or data. The agent
  gets no shell and no MCP servers, and deny rules block edits to the base's code, the hook copy and the data.
  `acceptEdits` is not a sandbox: treat whatever the agent reads (web pages, files) as able to steer it. The hook
  that every Claude Code session runs is a copy outside the checkout, so an agent cannot change it.

## Reporting a vulnerability

Please report suspected vulnerabilities privately through GitHub:
**Security → Report a vulnerability** on this repository. Do not open a public issue for security problems.

Include what you found, how to reproduce it and what an attacker could do with it. You will get a reply as soon
as possible, and fixes will be credited unless you prefer otherwise.

## Supported versions

Only the latest commit on `main` is supported.
