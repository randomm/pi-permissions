# @randomm/pi-permissions

[![CI](https://github.com/randomm/pi-permissions/actions/workflows/ci.yml/badge.svg)](https://github.com/randomm/pi-permissions/actions/workflows/ci.yml)

Deny-by-default tool interception for Pi agent sessions. Intercepts all tool calls (bash, read, write, edit, etc.) and enforces per-project allow/deny rules with persistent decision logging.

## Installation

```
pi install npm:@randomm/pi-permissions
```

## Configuration

Create `.pi/permissions.json` in your project root:

```json
{
  "default": "deny",
  "bash": {
    "*": "deny",
    "npm install *": "allow",
    "git diff *": "allow",
    "git push *": "deny"
  },
  "tools": {
    "read": "allow",
    "write": "deny",
    "edit": "deny"
  }
}
```

### Config format

- **`default`**: `"allow"` or `"deny"` — fallback when no rule matches
- **`bash`**: Pattern rules for bash tool calls. `*` matches everything
- **`tools`**: Exact tool name rules (e.g., `"read": "allow"`)

## How It Works

1. On `session_start`, the plugin loads `.pi/permissions.json` and caches it
2. On every `tool_call`, it checks:
   - Cached user decisions (from previous sessions) — highest priority
   - Bash pattern rules in `config.bash` (wildcard matching)
   - Tool-specific rules in `config.tools` (exact match)
   - `config.default` fallback
3. If no rule matches a cached decision, the user is prompted via `ctx.ui.confirm()`
4. On approve: decision is saved to `.pi/permissions.json` — future calls use the cached decision
5. On deny: decision is saved persistently — the agent is never asked again for this exact call

### Decision log

User decisions are stored in the same file under `_decisions`:

```json
{
  "_decisions": {
    "bash:npm install lodash": { "allowed": true, "timestamp": "2026-04-23T10:00:00Z" }
  },
  "bash": { ... },
  "tools": { ... }
}
```

### Wildcard matching

Patterns use simple glob-style matching where `*` matches everything including spaces:

- `npm install *` matches `npm install lodash` but not `npm uninstall lodash`
- `git diff *` matches `git diff --staged` but not `git push origin`
- `*` matches any input

### Persistence

- Atomic writes via temp file + rename
- Corruption handling with `.corrupted` backup
- Deny decisions are persistent across sessions

## License

MIT
