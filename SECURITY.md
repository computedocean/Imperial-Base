# Security policy

Imperial Base is a local application. It is designed to run on your own computer and to be reachable only from it.

## Security model

- **Loopback only.** The server binds to `127.0.0.1`. Changing `IMPERIAL_HOST` to another address exposes the
  base to your network and is not supported.
- **Cross-site protection.** The order endpoints require a loopback caller, a loopback `Host` header, an `Origin`
  that is exactly the base's own page (or the Vite dev server) and a JSON body. The WebSocket refuses pages from
  any other origin, and only loopback connections receive order conversations.
- **Minimal capture.** The Claude Code hook never stores tool inputs or outputs, file contents, full commands or
  full prompts, and redacts secrets before writing. The backend accepts only an allow-list of fields.
- **Orders are powerful.** An order starts a Claude Code agent with `acceptEdits` permissions in the project
  folder. It can edit any file there, including the base's own code. Anything else is limited by your own Claude
  Code permission settings. Set `IMPERIAL_ORDERS=0` if you do not want this capability.

## Reporting a vulnerability

Please report suspected vulnerabilities privately through GitHub:
**Security → Report a vulnerability** on this repository. Do not open a public issue for security problems.

Include what you found, how to reproduce it and what an attacker could do with it. You will get a reply as soon
as possible, and fixes will be credited unless you prefer otherwise.

## Supported versions

Only the latest commit on `main` is supported.
