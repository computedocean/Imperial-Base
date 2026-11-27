#!/usr/bin/env node
// IMPERIAL BASE — Claude Code hook (event capture).
//
// Reads the hook JSON payload from stdin, reduces it to a small SANITISED record and
// appends one JSON line to  %USERPROFILE%\.imperial-base\spool\events.jsonl
// The Imperial Base backend tails that file. Design rules:
//   * no network, no stdout (stdout of some hooks is injected into Claude's context)
//   * never blocks or alters a session: always exits 0, hard 1.5 s ceiling
//   * never stores file contents, tool outputs, full commands or full prompts
//   * redacts things that look like secrets before anything touches disk
'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')

const done = () => process.exit(0)
if (require.main === module) setTimeout(done, 1500).unref()

const ROOT = process.env.IMPERIAL_BASE_DIR || path.join(os.homedir(), '.imperial-base')
const SPOOL = path.join(ROOT, 'spool', 'events.jsonl')
const MAX_SPOOL = 20 * 1024 * 1024 // rotate at 20 MB

// Secret redaction. Applied in this order; backend/app/redact.py applies the same patterns again on the server.
// Keep the two in step (backend/tests/test_security_medium.py checks both against the same literal table).
const R = '[redacted]'
const SECRET_KEYS = '(?:api[_-]?key|apikey|access[_-]?key|secret[_-]?key|private[_-]?key|client[_-]?secret|secret|token|password|passwd|passphrase|pwd|pass|auth|credentials?|cookie)'
// (?!\[redacted\]) keeps redaction idempotent: a value already replaced is not matched again (the backend redacts the
// hook's output a second time, and the record's fields pass through redact() twice).
const SECRET_RULES = [
  // Authorization headers: the scheme word and the credential both go
  [/\b((?:proxy-)?authorization)(["']?\s*[:=]\s*)(?:(?:bearer|basic|digest|token|negotiate|ntlm)\s+)?(?!\[redacted\])("[^"]*"|'[^']*'|[^\s,;&'"]+)/gi, `$1$2${R}`],
  // user info in URLs: scheme://user:password@host
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/?#@]+@/gi, `$1${R}@`],
  // command-line options followed by their value: --password x, --api-key x, --db-token "x"
  [/(?<![\w-])(--?(?:[a-z0-9]+-)*(?:password|passwd|pass|pwd|token|secret|api-?key|apikey|auth|credentials?|private-key|access-key|client-secret))(\s+)(?!\[redacted\])("[^"]*"|'[^']*'|[^\s"']+)/gi, `$1$2${R}`],
  // key = value / key: value / "key": "value" (environment, JSON, YAML, query strings), any prefix: DB_PASSWORD=...
  [new RegExp(`(?<![A-Za-z0-9])((?:[A-Za-z0-9]+[_.-])*${SECRET_KEYS})(["']?\\s*[:=]\\s*)(?!\\[redacted\\])("[^"]*"|'[^']*'|[^\\s,;&'"}\\])]+)`, 'gi'), `$1$2${R}`],
  // a bare scheme credential
  [/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi, `$1 ${R}`],
  // well-known token formats
  [/\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{8,}/g, R],
  [/\bwhsec_[A-Za-z0-9]{16,}/g, R],
  [/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{8,}/g, R],
  [/\bgh[pousr]_[A-Za-z0-9]{16,}/g, R],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, R],
  [/\bglpat-[A-Za-z0-9_-]{20,}/g, R],
  [/\bhf_[A-Za-z0-9]{20,}/g, R],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, R],
  [/\bAKIA[0-9A-Z]{16}\b/g, R],
  [/\bAIza[0-9A-Za-z_-]{20,}/g, R],
  [/\bnpm_[A-Za-z0-9]{30,}/g, R],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, R],
  // long hex strings (API keys, hashes) and long random-looking strings
  [/\b[0-9a-fA-F]{32,}\b/g, R],
  [/\b[A-Za-z0-9+/_-]{40,}\b/g, R],
  // e-mail addresses
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, R],
]
function redactText(s) {
  let o = String(s == null ? '' : s)
  for (const [re, to] of SECRET_RULES) o = o.replace(re, to)
  return o
}
function redact(s, max) {
  const o = redactText(s).replace(/\s+/g, ' ').trim()
  return max && o.length > max ? o.slice(0, max - 1) + '…' : o
}
// Fields that identify a session, a tool call or a local path written by Claude Code itself. Every other string in
// the record goes through redact() once more before it is written, whatever field it came from.
const IDENTITY_FIELDS = new Set(['v', 'ts', 'event', 'session_id', 'tool_use_id', 'agent_id', 'cwd', 'project',
  'transcript_path', 'agent_transcript_path'])
const base = (p) => (p ? path.basename(String(p)) : undefined)
function host(u) {
  try { return new URL(String(u)).hostname } catch (_) { return undefined }
}

// A short, privacy-preserving description of what a tool call is about.
function toolTarget(name, input) {
  if (!input || typeof input !== 'object') return undefined
  switch (name) {
    case 'Read': case 'Write': case 'Edit': case 'MultiEdit': case 'NotebookEdit':
      return base(input.file_path || input.notebook_path)
    case 'Bash': case 'PowerShell':
      // the human-written description, never the raw command
      return input.description ? redact(input.description, 80) : redact(String(input.command || '').split(/\s+/)[0], 24)
    case 'Glob': return redact(input.pattern, 60)
    case 'Grep': return input.glob ? redact(input.glob, 40) : 'search'
    case 'WebFetch': return host(input.url)
    case 'WebSearch': return redact(input.query, 60)
    case 'Agent': case 'Task':
      return redact(input.description || '', 80)
    case 'Skill': return redact(input.skill || input.command || '', 60)
    case 'TodoWrite': return Array.isArray(input.todos) ? `${input.todos.length} todos` : undefined
    default:
      return undefined
  }
}

function errorText(resp) {
  if (resp == null) return undefined
  if (typeof resp === 'string') return redact(resp, 200)
  if (typeof resp === 'object') return redact(resp.error || resp.message || resp.stderr || '', 200) || undefined
  return undefined
}

// Cursor fires the same hooks with camelCase names; record them under the Claude Code names.
const EVENT_ALIASES = {
  sessionStart: 'SessionStart', sessionEnd: 'SessionEnd', beforeSubmitPrompt: 'UserPromptSubmit',
  preToolUse: 'PreToolUse', postToolUse: 'PostToolUse', postToolUseFailure: 'PostToolUseFailure',
  subagentStart: 'SubagentStart', subagentStop: 'SubagentStop', stop: 'Stop',
}

function reduce(p) {
  const rawName = p.hook_event_name || 'Unknown'
  const ev = Object.prototype.hasOwnProperty.call(EVENT_ALIASES, rawName) ? EVENT_ALIASES[rawName] : rawName
  const isCursor = p.cursor_version != null
  // Cursor sends workspace_roots instead of cwd
  const cwd = p.cwd || (Array.isArray(p.workspace_roots) && typeof p.workspace_roots[0] === 'string' ? p.workspace_roots[0] : undefined)
  const r = {
    v: 1,
    ts: new Date().toISOString(),
    event: ev,
    client: isCursor ? 'cursor' : undefined,
    session_id: p.session_id || p.conversation_id,
    cwd,
    project: base(cwd),
    transcript_path: p.transcript_path || undefined,
    permission_mode: p.permission_mode,
    // subagent context (present on events fired inside a subagent, and on SubagentStart/Stop)
    agent_id: p.agent_id,
    agent_type: p.agent_type,
    // evidence for schema validation: which top-level keys the runtime actually sent (names only)
    raw_keys: Object.keys(p).sort(),
  }
  switch (ev) {
    case 'SessionStart':
      r.source = p.source; r.model = p.model; break
    case 'SessionEnd':
      r.reason = p.reason; break
    case 'UserPromptSubmit':
      r.prompt_excerpt = redact(p.prompt, 160); break
    case 'PreToolUse':
    case 'PostToolUse':
    case 'PostToolUseFailure':
    case 'PermissionRequest':
      r.tool_name = p.tool_name
      r.tool_use_id = p.tool_use_id
      r.tool_target = toolTarget(p.tool_name, p.tool_input)
      if (p.tool_name === 'Agent' || p.tool_name === 'Task') {
        const ti = p.tool_input || {}
        r.subagent_type = ti.subagent_type
        r.delegation = redact(ti.description || '', 120)
      }
      if (ev === 'PostToolUseFailure') r.error = redact(p.error || errorText(p.tool_response) || 'tool failed', 200)
      if (ev === 'PostToolUse' && p.tool_response && typeof p.tool_response === 'object' && p.tool_response.is_error) {
        r.error = errorText(p.tool_response)
      }
      break
    case 'SubagentStart':
      break
    case 'SubagentStop':
      r.agent_transcript_path = p.agent_transcript_path
      r.summary = p.last_assistant_message ? redact(p.last_assistant_message, 240) : undefined
      break
    case 'Stop':
      r.summary = p.last_assistant_message ? redact(p.last_assistant_message, 240) : undefined
      break
    case 'StopFailure':
      r.error = redact(p.error || p.reason || p.message || 'stop failure', 200); break
    case 'Notification':
      r.notification_type = p.notification_type
      r.message = redact(p.message, 120); break
    default:
      break
  }
  if (isCursor && typeof p.model === 'string' && p.model) r.model = p.model
  for (const k of Object.keys(r)) {
    if (IDENTITY_FIELDS.has(k)) continue
    if (typeof r[k] === 'string') r[k] = redact(r[k], 600)
    else if (k === 'raw_keys') r[k] = r[k].map((x) => redact(x, 64))
    else if (r[k] && typeof r[k] === 'object') r[k] = scrubObject(r[k])
  }
  for (const k of Object.keys(r)) if (r[k] === undefined || r[k] === null || r[k] === '') delete r[k]
  return r
}

// Nested values (the SessionStart model object, say): strings redacted at any depth, size and depth bounded.
function scrubObject(v, depth = 0) {
  if (depth > 4) return undefined
  if (typeof v === 'string') return redact(v, 200)
  if (typeof v === 'number' || typeof v === 'boolean') return v
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => scrubObject(x, depth + 1))
  if (v && typeof v === 'object') {
    const out = {}
    for (const k of Object.keys(v).slice(0, 20)) out[redact(k, 64)] = scrubObject(v[k], depth + 1)
    return out
  }
  return undefined
}

if (require.main === module) {
  let buf = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (d) => { buf += d; if (buf.length > 4 * 1024 * 1024) buf = buf.slice(0, 4 * 1024 * 1024) })
  process.stdin.on('end', () => {
    try {
      const payload = JSON.parse(buf || '{}')
      const rec = reduce(payload)
      fs.mkdirSync(path.dirname(SPOOL), { recursive: true })
      try {
        if (fs.statSync(SPOOL).size > MAX_SPOOL) fs.renameSync(SPOOL, SPOOL + '.' + Date.now() + '.old')
      } catch (_) { /* no spool yet */ }
      fs.appendFileSync(SPOOL, JSON.stringify(rec) + '\n')
    } catch (_) { /* never fail a session */ }
    done()
  })
  process.stdin.on('error', done)
}

module.exports = { reduce, redact, redactText, toolTarget }
