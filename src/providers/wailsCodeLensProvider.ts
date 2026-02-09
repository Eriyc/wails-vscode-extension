import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import {
  isInsideBindingsDir,
  getBindingsDir,
  getFullBindingsPath,
  isWailsBindingsFile,
  invalidateTaskfileCache,
} from "./wailsBindingsUtils";

/**
 * Resolve TypeScript/SvelteKit path aliases like $lib to their actual paths.
 * Reads tsconfig.json or svelte.config.js to find path mappings.
 */
function resolvePathAlias(workspacePath: string, alias: string): string | null {
  // Try tsconfig.json first (works for both TS and SvelteKit)
  try {
    const tsconfigPath = path.join(workspacePath, "tsconfig.json");
    if (fs.existsSync(tsconfigPath)) {
      const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, "utf-8"));
      const pathMappings = tsconfig.compilerOptions?.paths;
      
      if (pathMappings) {
        // Look for mapping like "$lib/*" -> "src/lib/*"
        const aliasPattern = `${alias}/*`;
        if (pathMappings[aliasPattern]) {
          const mappedPath = pathMappings[aliasPattern][0].replace("/*", "");
          return mappedPath;
        }
      }
    }
  } catch (error) {
    
  }
  
  // Common SvelteKit defaults
  if (alias === "$lib") {
    return "src/lib";
  }
  
  return null;
}

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
    
    
    // Extract just the directory name (last segment) for specifier checks
    // e.g., "frontend/src/lib/bindings" -> "bindings"
    const bindingsDirName = bindingsDir.split('/').pop() || 'bindings';
    

    // --- Glue file: show lens on each exported function ---
    if (
      isWailsBindingsFile(document) &&
      isInsideBindingsDir(document.uri.fsPath, workspaceFolder.uri.fsPath, bindingsDir)
    ) {
      
      return this.lensesForBindingsFile(document);
    }

    // --- User code: show lens on call-sites of bindings imports ---
    
    return this.lensesForUserCode(document, bindingsDirName);
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
      } else {
        
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
      } else {
        
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
    
    const result = segments.includes(bindingsDir);
    
    return result;
  }

  /**
   * Resolve the import specifier to a URI for the actual binding file.
   * For a namespace import from "../bindings/changeme" and method "Greet",
   * we want to point at the service file (e.g. greetservice.ts), not the index file.
   */
  private resolveSpecifier(
    document: vscode.TextDocument,
    specifier: string,
    symbolName: string,
  ): vscode.Uri {
    const dir = path.dirname(document.uri.fsPath);
    let resolved = specifier;
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    
    
    
    // Handle path aliases like $lib/, @/, etc.
    const aliasMatch = specifier.match(/^(\$\w+|@\w*)\//);
    if (aliasMatch) {
      
      const alias = aliasMatch[1];
      if (workspaceFolder) {
        const aliasPath = resolvePathAlias(workspaceFolder.uri.fsPath, alias);
        if (aliasPath) {
          
          resolved = specifier.replace(aliasMatch[1], aliasPath);
        }
      }
    }
    
    // If the resolved path contains the bindings directory, use the full bindings path from Taskfile
    if (workspaceFolder && resolved.includes('/bindings/')) {
      const fullBindingsPath = getFullBindingsPath(workspaceFolder);
      const bindingsMatch = resolved.match(/(.*)\/bindings\/(.*)/);
      if (bindingsMatch) {
        
        // Get the part after /bindings/
        const afterBindings = bindingsMatch[2];
        // Reconstruct the path with the full bindings path
        resolved = `${fullBindingsPath}/${afterBindings}`;
        
      }
    }
    
    // Resolve path
    let baseDir: string;
    if (workspaceFolder && !path.isAbsolute(resolved)) {
      baseDir = workspaceFolder.uri.fsPath;
    } else {
      baseDir = dir;
    }
    
    let resolved_path = path.resolve(baseDir, resolved);
    

    // If it doesn't have a JS/TS extension, try to resolve it
    if (!/\.(js|ts|mjs|mts)$/.test(resolved_path)) {
      const dirPath = resolved_path;
      
      // First, try to access as file with extensions
      for (const ext of [".ts", ".js", ".d.ts"]) {
        const candidate = resolved_path + ext;
        try {
          fs.accessSync(candidate);
          
          return vscode.Uri.file(candidate);
        } catch {
          // continue
        }
      }
      
      // Then try as directory
      try {
        const files = fs.readdirSync(dirPath);
        
        
        // Try to find a file that matches the method name (case-insensitive, lowercase)
        const symbolLower = symbolName.toLowerCase();
        for (const file of files) {
          if (file === 'index.js' || file === 'index.ts') {
            continue; // Skip index files
          }
          const fileLower = file.toLowerCase();
          // Check if the file name contains the symbol name
          if (fileLower.includes(symbolLower) && /\.(js|ts)$/.test(file)) {
            const candidate = path.join(dirPath, file);
            
            return vscode.Uri.file(candidate);
          }
        }
        
        // Fallback: try index files
        for (const ext of ["/index.js", "/index.ts", ".js", ".ts"]) {
          const candidate = resolved_path + ext;
          try {
            fs.accessSync(candidate);
            resolved_path = candidate;
            
            break;
          } catch {
            // continue
          }
        }
      } catch (err) {
        
      }
    }

    return vscode.Uri.file(resolved_path);
  }

  private escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
}
