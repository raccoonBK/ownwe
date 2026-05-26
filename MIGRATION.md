# Roundtable Separation Notes

This project is a copied, independent Roundtable app extracted from `<source-project-root>`.

## Copied Surface

- `src/app/roundtable-server.js`
- `public/roundtable/**`
- `scripts/roundtable-open.js`
- `scripts/roundtable-checkin.js`
- `test/roundtable-checkin.test.js`
- Local runtime adapter subset under `src/adapters/runtime/**`

No `.env`, `.mcp.json`, `.codex`, keys, or Cyberboss runtime state were copied.

## Replaced Cyberboss Dependencies

- `../core/config`
  - Replaced with local `src/core/config.js`.
  - Uses `ROUNDTABLE_*` environment variables only.
  - Default state directory is `%USERPROFILE%\.cyberboss-roundtable`.

- `../adapters/runtime/codex`
  - Copied into this project as local runtime code.
  - Cyberboss MCP auto-injection is disabled in `src/adapters/runtime/codex/mcp-config.js`.
  - Codex command env is now `ROUNDTABLE_CODEX_COMMAND`.

- `../adapters/runtime/claudecode`
  - Copied into this project as local runtime code.
  - `.mcp.json` writing and `cyberboss_tools` injection are disabled in `src/adapters/runtime/claudecode/project-settings.js`.
  - Claude command env is now `ROUNDTABLE_CLAUDE_COMMAND`.

## Useful Commands

```powershell
npm run check
npm test
$env:ROUNDTABLE_CHECKIN_ENABLED='false'; $env:ROUNDTABLE_PORT='8797'; npm run roundtable
```

## Remaining Work

- Decide whether to migrate or discard old state from `<source-state-dir>\roundtable`.
- Decide whether Roundtable should have its own optional MCP/tool allowlist.
- Runtime approvals are no longer accepted unconditionally. Only the narrow built-in Roundtable tool allowlist is auto-approved; other approvals stay visible in state for manual handling or future UI work.
- After this standalone app is accepted, remove Roundtable scripts and entrypoints from the old Cyberboss project in a separate change.
