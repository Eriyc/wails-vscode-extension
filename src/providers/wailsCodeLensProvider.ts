import * as vscode from "vscode";
import * as path from "path";
import {
  isInsideBindingsDir,
  getBindingsDir,
  isWailsBindingsFile,
  invalidateTaskfileCache,
} from "./wailsBindingsUtils";

/**
 * Import info extracted from a single import statement that references
 * a bindings path.
 */
interface BindingsImport {
  /** The local name used in code (e.g. "GreetService"). */
  localName: string;
  /** Whether this is a namespace import (`import * as X`). */
  isNamespace: boolean;
  /** The relative import specifier (e.g. "../bindings/changeme"). */
  specifier: string;
}

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
    const imports = this.parseBindingsImports(document, bindingsDir);
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
            `${this.escapeRegExp(imp.localName)}\\.([A-Za-z_$][A-Za-z0-9_$]*)\\s*\\(`,
            "g",
          );
          let m: RegExpExecArray | null;
          while ((m = nsRegex.exec(lineText)) !== null) {
            if (seenLines.has(i)) {
              break;
            }
            seenLines.add(i);

            const methodName = m[1];
            const bindingUri = this.resolveSpecifier(document, imp.specifier, methodName);

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
          const callRegex = new RegExp(`\\b${this.escapeRegExp(imp.localName)}\\s*\\(`, "g");
          const callMatch = callRegex.exec(lineText);
          if (callMatch && !seenLines.has(i)) {
            seenLines.add(i);

            const col = callMatch.index;
            const bindingUri = this.resolveSpecifier(document, imp.specifier, imp.localName);

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

  // ---------------------------------------------------------------------------
  // Import parsing
  // ---------------------------------------------------------------------------

  /**
   * Extracts all import statements whose specifier contains the bindings dir.
   *
   * Handles:
   *   import { Foo, Bar } from "../bindings/pkg"
   *   import * as Pkg from "../bindings/pkg"
   *   import Pkg from "../bindings/pkg"
   */
  private parseBindingsImports(
    document: vscode.TextDocument,
    bindingsDir: string,
  ): BindingsImport[] {
    const text = document.getText();
    const results: BindingsImport[] = [];

    // Namespace: import * as Name from "...bindings..."
    const nsRegex = /import\s+\*\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*)\s+from\s+['"]([^'"]*)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = nsRegex.exec(text)) !== null) {
      if (this.specifierContainsBindings(m[2], bindingsDir)) {
        results.push({ localName: m[1], isNamespace: true, specifier: m[2] });
      }
    }

    // Named: import { A, B } from "...bindings..."
    const namedRegex = /import\s+\{([^}]+)\}\s+from\s+['"]([^'"]*)['"]/g;
    while ((m = namedRegex.exec(text)) !== null) {
      if (this.specifierContainsBindings(m[2], bindingsDir)) {
        const names = m[1]
          .split(",")
          .map((n) =>
            n
              .trim()
              .split(/\s+as\s+/)
              .pop()!
              .trim(),
          )
          .filter(Boolean);
        for (const name of names) {
          results.push({ localName: name, isNamespace: true, specifier: m[2] });
        }
      }
    }

    // Default: import Name from "...bindings..."
    const defaultRegex = /import\s+([A-Za-z_$][A-Za-z0-9_$]*)\s+from\s+['"]([^'"]*)['"]/g;
    while ((m = defaultRegex.exec(text)) !== null) {
      if (this.specifierContainsBindings(m[2], bindingsDir)) {
        results.push({ localName: m[1], isNamespace: true, specifier: m[2] });
      }
    }

    return results;
  }

  /** Check if an import specifier like `../bindings/changeme` contains the bindings dir segment. */
  private specifierContainsBindings(specifier: string, bindingsDir: string): boolean {
    const segments = specifier.split("/");
    return segments.includes(bindingsDir);
  }

  /**
   * Resolve the import specifier to a URI used as the binding file for Go lookup.
   * For a namespace import from "../bindings/changeme" and method "Greet",
   * we want to point at the service file (e.g. greetservice.js) but since we
   * don't know the filename, we pass the directory index file — the Go lookup
   * will match by symbol name across all Go files anyway.
   */
  private resolveSpecifier(
    document: vscode.TextDocument,
    specifier: string,
    _symbolName: string,
  ): vscode.Uri {
    const dir = path.dirname(document.uri.fsPath);
    let resolved = path.resolve(dir, specifier);

    // If it doesn't have a JS/TS extension, try common index files
    if (!/\.(js|ts|mjs|mts)$/.test(resolved)) {
      for (const ext of ["/index.js", "/index.ts", ".js", ".ts"]) {
        const candidate = resolved + ext;
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require("fs").accessSync(candidate);
          resolved = candidate;
          break;
        } catch {
          // continue
        }
      }
    }

    return vscode.Uri.file(resolved);
  }

  private escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
}
