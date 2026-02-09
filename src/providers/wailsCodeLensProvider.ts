import * as vscode from "vscode";
import { isInsideBindingsDir, getBindingsDir, isWailsBindingsFile } from "./wailsBindingsUtils";

import {
  escapeRegExp,
  parseBindingsImports,
  resolveBindingsSpecifier,
} from "./wailsBindingsImportUtils";

/**
 * Shows "Go to Go implementation" CodeLens in two places:
 *
 * 1. **User code** — above every call-site that uses a symbol imported from a
 *    bindings path (e.g. `GreetService.Greet(name)`).
 *
 * 2. **Binding glue files** — above every `export function` in the
 *    auto-generated file.
 */
export class WailsCodeLensProvider implements vscode.CodeLensProvider {
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChange.event;

  provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken,
  ): vscode.CodeLens[] {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!workspaceFolder) {
      return [];
    }

    const bindingsDir = getBindingsDir(workspaceFolder);

    // --- Glue file: show lens on each exported function ---
    if (
      isWailsBindingsFile(document) &&
      isInsideBindingsDir(document.uri.fsPath, workspaceFolder.uri.fsPath, bindingsDir)
    ) {
      return this.lensesForBindingsFile(document);
    }

    // --- User code: show lens on call-sites of bindings imports ---
    return this.lensesForUserCode(document, bindingsDir);
  }

  // ---------------------------------------------------------------------------
  // Glue file lenses
  // ---------------------------------------------------------------------------

  private lensesForBindingsFile(document: vscode.TextDocument): vscode.CodeLens[] {
    const lenses: vscode.CodeLens[] = [];
    const text = document.getText();
    const regex = /^export\s+function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/gm;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      const pos = document.positionAt(match.index);
      lenses.push(
        new vscode.CodeLens(new vscode.Range(pos, pos), {
          title: "$(go-to-file) Go to Go implementation",
          command: "wails.goToBackend",
          arguments: [document.uri, match[1]],
          tooltip: `Jump to the Go source for ${match[1]}`,
        }),
      );
    }

    return lenses;
  }

  // ---------------------------------------------------------------------------
  // User-code lenses
  // ---------------------------------------------------------------------------

  private lensesForUserCode(document: vscode.TextDocument, bindingsDir: string): vscode.CodeLens[] {
    const imports = parseBindingsImports(document, bindingsDir);
    if (imports.length === 0) {
      return [];
    }

    const lenses: vscode.CodeLens[] = [];
    // Deduplicate: at most one lens per line
    const seenLines = new Set<number>();

    for (let i = 0; i < document.lineCount; i++) {
      const lineText = document.lineAt(i).text;

      for (const imp of imports) {
        if (imp.isNamespace) {
          // Namespace import: look for  ServiceName.Method(
          const nsRegex = new RegExp(
            `${escapeRegExp(imp.localName)}\\.([A-Za-z_$][A-Za-z0-9_$]*)\\s*\\(`,
            "g",
          );
          let m: RegExpExecArray | null;
          while ((m = nsRegex.exec(lineText)) !== null) {
            if (seenLines.has(i)) {
              break;
            }
            seenLines.add(i);

            const methodName = m[1];
            const bindingUri = resolveBindingsSpecifier(document, imp.specifier);

            const methodIndex = lineText.indexOf(methodName, lineText.indexOf(imp.localName));
            if (methodIndex < 0) continue;

            const range = new vscode.Range(
              new vscode.Position(i, methodIndex),
              new vscode.Position(i, methodIndex + methodName.length),
            );

            lenses.push(
              new vscode.CodeLens(range, {
                title: `$(go-to-file) Go to Go: ${imp.localName}.${methodName}`,
                command: "wails.goToBackend",
                arguments: [bindingUri, methodName],
                tooltip: `Jump to the Go source for ${methodName}`,
              }),
            );
          }
        } else {
          // Named import: look for the function call  FuncName(
          const callRegex = new RegExp(`\\b${escapeRegExp(imp.localName)}\\s*\\(`, "g");
          const callMatch = callRegex.exec(lineText);
          if (callMatch && !seenLines.has(i)) {
            seenLines.add(i);

            const col = callMatch.index;
            const bindingUri = resolveBindingsSpecifier(document, imp.specifier);

            lenses.push(
              new vscode.CodeLens(new vscode.Range(i, col, i, col), {
                title: `$(go-to-file) Go to Go: ${imp.localName}`,
                command: "wails.goToBackend",
                arguments: [bindingUri, imp.localName],
                tooltip: `Jump to the Go source for ${imp.localName}`,
              }),
            );
          }
        }
      }
    }

    return lenses;
  }
}
