import * as vscode from "vscode";

import {
  isInsideBindingsDir,
  getBindingsDir,
  isWailsBindingsFile,
  findGoDefinition,
} from "./wailsBindingsUtils";
import {
  escapeRegExp,
  parseBindingsImports,
  resolveBindingsSpecifier,
} from "./wailsBindingsImportUtils";

/**
 * Import info extracted from a single import statement that references
 * a bindings path.
 */


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
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!workspaceFolder) {
      return undefined;
    }

    const bindingsDir = getBindingsDir(workspaceFolder);

    // --- Case 1: Inside a bindings file itself ---
    if (
      isWailsBindingsFile(document) &&
      isInsideBindingsDir(document.uri.fsPath, workspaceFolder.uri.fsPath, bindingsDir)
    ) {
      return this.hoverForBindingsFile(document, position, workspaceFolder);
    }

    // --- Case 2: User code - hover on binding imports ---
    return this.hoverForUserCode(document, position, workspaceFolder, bindingsDir);
  }

  // ---------------------------------------------------------------------------
  // Case 1: Hover in bindings files
  // ---------------------------------------------------------------------------

  private async hoverForBindingsFile(
    document: vscode.TextDocument,
    position: vscode.Position,
    workspaceFolder: vscode.WorkspaceFolder,
  ): Promise<vscode.Hover | undefined> {
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

    return this.createHover(document, word, wordRange, workspaceFolder);
  }

  // ---------------------------------------------------------------------------
  // Case 2: Hover in user code
  // ---------------------------------------------------------------------------

  private async hoverForUserCode(
    document: vscode.TextDocument,
    position: vscode.Position,
    workspaceFolder: vscode.WorkspaceFolder,
    bindingsDir: string,
  ): Promise<vscode.Hover | undefined> {
    const imports = parseBindingsImports(document, bindingsDir);
    if (imports.length === 0) {
      return undefined;
    }

    const wordRange = document.getWordRangeAtPosition(position);
    if (!wordRange) {
      return undefined;
    }

    const word = document.getText(wordRange);
    const line = document.lineAt(position.line).text;

    // Check if this word matches any imported binding symbol
    for (const imp of imports) {
      if (imp.isNamespace) {
        // Namespace import: check if hovering on the method name in Namespace.Method(
        const nsPattern = new RegExp(
          `${escapeRegExp(imp.localName)}\\.([A-Za-z_$][A-Za-z0-9_$]*)\\s*\\(`,
        );
        const match = line.match(nsPattern);
        if (match && match[1] === word) {
          // Hovering on the method name
          const bindingUri = resolveBindingsSpecifier(document, imp.specifier);
          return this.createHover(bindingUri, word, wordRange, workspaceFolder);
        }
      } else {
        // Named import: check if hovering on the function call FuncName(
        if (word === imp.localName) {
          const callPattern = new RegExp(`\\b${escapeRegExp(imp.localName)}\\s*\\(`);
          if (callPattern.test(line)) {
            const bindingUri = resolveBindingsSpecifier(document, imp.specifier);
            return this.createHover(bindingUri, word, wordRange, workspaceFolder);
          }
        }
      }
    }

    return undefined;
  }

  // ---------------------------------------------------------------------------
  // Helper: Create the hover
  // ---------------------------------------------------------------------------

  private async createHover(
    bindingUriOrDoc: vscode.Uri | vscode.TextDocument,
    symbolName: string,
    range: vscode.Range,
    workspaceFolder: vscode.WorkspaceFolder,
  ): Promise<vscode.Hover | undefined> {
    const bindingUri =
      bindingUriOrDoc instanceof vscode.Uri ? bindingUriOrDoc : bindingUriOrDoc.uri;

    const goLocation = await findGoDefinition(workspaceFolder, bindingUri, symbolName);
    if (!goLocation) {
      return undefined;
    }

    const goRelPath = vscode.workspace.asRelativePath(goLocation.uri);
    const goLine = goLocation.range.start.line + 1;

    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.supportThemeIcons = true;

    const commandUri = vscode.Uri.parse(
      `command:wails.goToBackend?${encodeURIComponent(JSON.stringify([bindingUri, symbolName]))}`,
    );

    md.appendMarkdown(
      `$(go-to-file) **Auto-generated Wails3 binding**\n\n` +
        `[Open Go definition (\`${goRelPath}:${goLine}\`)](${commandUri})`,
    );

    return new vscode.Hover(md, range);
  }

  // ---------------------------------------------------------------------------
}
