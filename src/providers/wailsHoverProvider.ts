import * as vscode from "vscode";
import {
  isInsideBindingsDir,
  getBindingsDir,
  isWailsBindingsFile,
  findGoDefinition,
} from "./wailsBindingsUtils";

/**
 * Shows a hover with an "Open Go definition" link on exported functions
 * in Wails3 auto-generated binding files.
 */
export class WailsHoverProvider implements vscode.HoverProvider {
  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken,
  ): Promise<vscode.Hover | undefined> {
    if (!isWailsBindingsFile(document)) {
      return undefined;
    }

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!workspaceFolder) {
      return undefined;
    }

    const bindingsDir = getBindingsDir(workspaceFolder);
    if (!isInsideBindingsDir(document.uri.fsPath, workspaceFolder.uri.fsPath, bindingsDir)) {
      return undefined;
    }

    const wordRange = document.getWordRangeAtPosition(position);
    if (!wordRange) {
      return undefined;
    }

    const word = document.getText(wordRange);

    // Only show hover on exported function names
    const line = document.lineAt(position.line).text;
    const exportMatch = line.match(/^export\s+function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/);
    if (!exportMatch || exportMatch[1] !== word) {
      return undefined;
    }

    const goLocation = await findGoDefinition(workspaceFolder, document.uri, word);
    if (!goLocation) {
      return undefined;
    }

    const goRelPath = vscode.workspace.asRelativePath(goLocation.uri);
    const goLine = goLocation.range.start.line + 1;

    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.supportThemeIcons = true;

    const commandUri = vscode.Uri.parse(
      `command:wails.goToBackend?${encodeURIComponent(JSON.stringify([document.uri, word]))}`,
    );

    md.appendMarkdown(
      `$(go-to-file) **Auto-generated Wails3 binding**\n\n` +
        `[Open Go definition (\`${goRelPath}:${goLine}\`)](${commandUri})`,
    );

    return new vscode.Hover(md, wordRange);
  }
}
