# External Bridge Discovery + TUI Widget

## Context

The pi-vscode extension runs a localhost HTTP bridge so pi (running inside a VS Code terminal) can call back into VS Code for editor state, diagnostics, symbols, etc. Connection info is injected via environment variables (`PI_VSCODE_BRIDGE_URL`, `PI_VSCODE_BRIDGE_TOKEN`), which only works when pi is launched from VS Code.

Users often run pi from a normal terminal (Ghostty, kitty, etc.) while VS Code is open. This design adds file-based bridge discovery so any pi instance can connect to the running VS Code bridge, plus a TUI widget showing the active VS Code file and selection.

## Design

### 1. Connection File (VS Code side)

On bridge startup, write `~/.pi-vscode-bridge.json`:

```json
{
  "url": "http://127.0.0.1:54321",
  "token": "uuid-here",
  "pid": 12345,
  "workspaceFolder": "/path/to/project"
}
```

On bridge dispose / extension deactivation, delete the file. The `pid` field (VS Code's process PID) lets consumers detect stale files from crashed sessions.

**Files to modify:**

- `src/bridge/server.ts` or `src/extension.ts` — write file after bridge starts, delete on dispose

### 2. Global Pi Extension (new file)

A self-contained JS file installed manually at `~/.pi/agent/extensions/pi-vscode-bridge/index.js`. Pi auto-discovers extensions in this directory.

**Activation logic:**

1. If `PI_VSCODE_BRIDGE_URL` env var is set, skip entirely (the bundled `--extension` version handles this case)
2. Read `~/.pi-vscode-bridge.json`
3. Validate: check if `pid` process is still alive (`process.kill(pid, 0)`)
4. Try a health-check RPC call (e.g. `getWorkspaceFolders`)
5. If valid, register tools and set up widget

**Tool registration:**

- Self-contained copy of the 28 bridge tool definitions (same names, schemas, RPC methods as the bundled extension)
- Same `callBridge(method, params)` HTTP fetch pattern

**Session hooks:**

- `pi.on("session_start", async (_event, ctx) => { ... })` — read connection file, validate, register polling, show initial widget
- `pi.on("session_shutdown", async () => { ... })` — clear polling interval

**Enable/disable:** Rename or delete the `~/.pi/agent/extensions/pi-vscode-bridge/` directory to disable. Restore to enable.

### 3. TUI Widget

Uses `ctx.ui.setWidget("pi-vscode", lines)` to show a status line in pi's TUI.

**Display format:**

- Connected with selection: `VS Code: src/bridge/server.ts L12-18`
- Connected, cursor only: `VS Code: src/bridge/server.ts L42`
- Connected, no file open: `VS Code: no file open`
- Disconnected/stale: `VS Code: disconnected`

File paths shown relative to `workspaceFolder` from the connection file.

**Polling:**

- Poll `getEditorState` every 2 seconds via the bridge RPC
- On poll failure (bridge died), update widget to "disconnected" and stop polling
- Extract active file path and selection range from the response

### 4. Source Organization

- `bridge/pi-vscode-bridge.js` — unchanged, bundled extension for VS Code terminal launches
- `bridge/pi-vscode-global.js` — new, self-contained global extension with connection file discovery + widget + tool definitions (shipped inside the VS Code extension for easy access)
- VS Code extension's README documents the manual install: `mkdir -p ~/.pi/agent/extensions/pi-vscode-bridge && cp bridge/pi-vscode-global.js ~/.pi/agent/extensions/pi-vscode-bridge/index.js`

### 5. Connection File Lifecycle

| Event                                    | Action                                                        |
| ---------------------------------------- | ------------------------------------------------------------- |
| Bridge starts (extension activation)     | Write `~/.pi-vscode-bridge.json`                              |
| Bridge disposes (extension deactivation) | Delete `~/.pi-vscode-bridge.json`                             |
| VS Code crashes                          | File left on disk; pi extension detects stale PID and ignores |
| New VS Code window opens                 | Overwrites the file (single-window design)                    |

## Verification

1. Start VS Code with the extension — verify `~/.pi-vscode-bridge.json` is written with correct url/token/pid
2. Close VS Code — verify the file is deleted
3. Kill VS Code (SIGKILL) — verify file remains but pi extension detects stale PID
4. Run pi from external terminal with VS Code open — verify tools are registered and widget shows active file
5. Change active file/selection in VS Code — verify widget updates within ~2s
6. Close VS Code while pi is running — verify widget shows "disconnected"
7. Run pi from VS Code terminal — verify global extension skips (no double registration)
