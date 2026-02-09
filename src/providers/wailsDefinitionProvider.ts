import * as vscode from "vscode";
import { isInsideBindingsDir, getBindingsDir, findGoDefinition } from "./wailsBindingsUtils";

/**
 * Provides "Go to Definition" for Wails3 bindings.
 *
 * Strategy: leverage VS Code's built-in definition resolution. When a
 * definition resolves to a file inside the configured bindings directory
 * (auto-generated JS/TS glue), we redirect to the corresponding Go source.
 *
 * Also handles the case where the user is already viewing a bindings file
 * and triggers "Go to Definition" on a symbol there.
 *
 * Note: this provider adds a Go result to the Definitions picker alongside
 * the built-in JS/TS result. For a direct single-jump experience, users
 * can use the "Go to Backend" command or clicked the CodeLens link.
 */
export class WailsDefinitionProvider implements vscode.DefinitionProvider {
  /** Guard flag to prevent infinite recursion when calling executeDefinitionProvider. */
  private isResolving = false;

  async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<vscode.Definition | vscode.LocationLink[] | undefined> {
    const wordRange = document.getWordRangeAtPosition(position);
    if (!wordRange) {
      return undefined;
    }

    const word = document.getText(wordRange);
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!workspaceFolder) {
      return undefined;
    }

    const bindingsDir = getBindingsDir(workspaceFolder);

    // Case 1: The current file is itself inside the bindings directory.
    if (isInsideBindingsDir(document.uri.fsPath, workspaceFolder.uri.fsPath, bindingsDir)) {
      return findGoDefinition(workspaceFolder, document.uri, word);
    }

    // Case 2: Ask VS Code's other providers where the definition lives.
    //         If it lands in a bindings file, redirect to Go.
    if (this.isResolving) {
      return undefined;
    }

    this.isResolving = true;
    try {
      const definitions = await vscode.commands.executeCommand<
        (vscode.Location | vscode.LocationLink)[]
      >("vscode.executeDefinitionProvider", document.uri, position);

      if (!definitions || token.isCancellationRequested) {
        return undefined;
      }

      for (const def of definitions) {
        const targetUri =
          def instanceof vscode.Location ? def.uri : (def as vscode.LocationLink).targetUri;
        if (isInsideBindingsDir(targetUri.fsPath, workspaceFolder.uri.fsPath, bindingsDir)) {
          return findGoDefinition(workspaceFolder, targetUri, word);
        }
      }
    } finally {
      this.isResolving = false;
    }

    return undefined;
  }
}
