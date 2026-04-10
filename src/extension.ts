import { unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import * as vscode from "vscode";
import { createBridge } from "./bridge/server.ts";
import { createChatHandler } from "./chat.ts";
import { TERMINAL_TITLE } from "./constants.ts";
import { createPiEnvironment, createPiShellArgs, findPiBinary, resolvePiShell } from "./pi.ts";
import { createPackagesViewProvider } from "./packages.ts";
import { buildOpenWithFileContext, createNewTerminal } from "./terminal.ts";

const CONNECTION_FILE = join(homedir(), ".pi-vscode-bridge.json");

let extensionUri: vscode.Uri;
let bridgeConfig: { url: string; token: string } | undefined;
let bridgeDispose: (() => Promise<void>) | undefined;

export async function activate(context: vscode.ExtensionContext) {
  extensionUri = context.extensionUri;

  const bridge = await createBridge(context);
  bridgeConfig = { url: bridge.url, token: bridge.token };
  bridgeDispose = () => bridge.dispose();

  void writeFile(
    CONNECTION_FILE,
    JSON.stringify({
      url: bridge.url,
      token: bridge.token,
      pid: process.pid,
      workspaceFolder: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null,
    }),
    "utf8",
  ).catch(() => {});

  context.subscriptions.push({
    dispose: () => {
      const dispose = bridgeDispose;
      bridgeDispose = undefined;
      bridgeConfig = undefined;
      void unlink(CONNECTION_FILE).catch(() => {});
      void dispose?.();
    },
  });

  const participant = vscode.chat.createChatParticipant(
    "pi-vscode.chat",
    createChatHandler({
      extensionUri,
      getBridgeConfig: () => bridgeConfig,
    }),
  );
  const logoIcon = {
    light: vscode.Uri.joinPath(extensionUri, "assets", "logo-light.svg"),
    dark: vscode.Uri.joinPath(extensionUri, "assets", "logo.svg"),
  };
  participant.iconPath = logoIcon;

  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.text = "$(pi-logo) Pi";
  statusBarItem.tooltip = "Open Pi Terminal";
  statusBarItem.command = "pi-vscode.open";
  statusBarItem.show();

  context.subscriptions.push(
    participant,
    statusBarItem,
    vscode.commands.registerCommand("pi-vscode.open", async () => {
      const terminal = await createNewTerminal({ extensionUri, bridgeConfig });
      terminal?.show();
    }),
    vscode.commands.registerCommand("pi-vscode.openWithFile", async () => {
      const terminal = await createNewTerminal({
        extensionUri,
        bridgeConfig,
        contextLines: buildOpenWithFileContext(),
      });
      terminal?.show();
    }),
    vscode.commands.registerCommand("pi-vscode.sendSelection", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const selection = editor.document.getText(editor.selection);
      if (!selection) return;
      const terminal = await createNewTerminal({
        extensionUri,
        bridgeConfig,
        extraArgs: [selection],
      });
      terminal?.show();
    }),
    vscode.commands.registerCommand("pi-vscode.openInNewWindow", async () => {
      const terminal = await createNewTerminal({ extensionUri, bridgeConfig });
      if (!terminal) return;
      terminal.show();
      await vscode.commands.executeCommand("workbench.action.moveEditorToNewWindow");
    }),
    vscode.window.registerWebviewViewProvider(
      "pi-vscode.packages",
      createPackagesViewProvider(findPiBinary),
    ),
    vscode.window.registerTerminalProfileProvider("pi-vscode.terminal-profile", {
      provideTerminalProfile() {
        const piPath = findPiBinary();
        const { shellPath, prependArgs } = resolvePiShell(piPath);
        const shellArgs = [...prependArgs, ...createPiShellArgs(extensionUri)];
        return new vscode.TerminalProfile({
          name: TERMINAL_TITLE,
          shellPath,
          shellArgs: shellArgs.length > 0 ? shellArgs : undefined,
          cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
          env: createPiEnvironment(piPath, bridgeConfig),
          iconPath: logoIcon,
        });
      },
    }),
  );
}

export async function deactivate() {
  for (const terminal of vscode.window.terminals) {
    if (terminal.name === TERMINAL_TITLE) terminal.dispose();
  }
  const dispose = bridgeDispose;
  bridgeDispose = undefined;
  bridgeConfig = undefined;
  await dispose?.();
  void unlink(CONNECTION_FILE).catch(() => {});
}
