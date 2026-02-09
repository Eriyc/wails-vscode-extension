import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import {
  isInsideBindingsDir,
  getBindingsDir,
  getFullBindingsPath,
  isWailsBindingsFile,
  findGoDefinition,
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
 * Shows a hover with an "Open Go definition" link on:
 * 1. Exported functions in Wails3 auto-generated binding files
 * 2. Calls to bindings functions in user code
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
    
    
    // Extract just the directory name (last segment) for specifier checks
    // e.g., "frontend/src/lib/bindings" -> "bindings"
    const bindingsDirName = bindingsDir.split('/').pop() || 'bindings';
    
    
    // Case 1: Inside a bindings file - hover on export function names
    if (isWailsBindingsFile(document) && isInsideBindingsDir(document.uri.fsPath, workspaceFolder.uri.fsPath, bindingsDir)) {
      
      return this.hoverInBindingsFile(document, position, workspaceFolder);
    }

    // Case 2: User code - hover on bindings function calls
    
    return this.hoverInUserCode(document, position, workspaceFolder, bindingsDirName);
  }

  private async hoverInBindingsFile(
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

  private async hoverInUserCode(
    document: vscode.TextDocument,
    position: vscode.Position,
    workspaceFolder: vscode.WorkspaceFolder,
    bindingsDir: string,
  ): Promise<vscode.Hover | undefined> {
    
    const wordRange = document.getWordRangeAtPosition(position);
    if (!wordRange) {
      
      return undefined;
    }

    const word = document.getText(wordRange);
    const line = document.lineAt(position.line).text;
    

    // Check if this word is part of a bindings import usage
    // e.g., GreetService.Greet(name) or simply Greet(name)
    const imports = this.parseBindingsImports(document, bindingsDir);
    
    if (imports.length === 0) {
      
      return undefined;
    }

    // Check if the word is either:
    // 1. A method call like GreetService.Greet
    // 2. A direct function call like Greet
    for (const imp of imports) {
      const nsPattern = new RegExp(`${this.escapeRegExp(imp.localName)}\\.`);
      if (nsPattern.test(line) && line.includes(word)) {
        // This might be a method call
        // e.g., GreetService.Greet - word might be "GreetService" or "Greet"
        const methodMatch = line.match(
          new RegExp(`${this.escapeRegExp(imp.localName)}\\.(${word})\\s*\\(`),
        );
        
        if (methodMatch) {
          // Word is the method name
          const bindingUri = await this.resolveBindingUri(document, imp.specifier, word);
          if (bindingUri) {
            return this.createGoHover(workspaceFolder, bindingUri, word, wordRange);
          }
        }
      } else if (imp.localName === word) {
        // Direct usage of the imported name GreetService
        const bindingUri = await this.resolveBindingUri(document, imp.specifier, word);
        if (bindingUri) {
          return this.createGoHover(workspaceFolder, bindingUri, word, wordRange);
        }
      }
    }

    return undefined;
  }

  private async createGoHover(
    workspaceFolder: vscode.WorkspaceFolder,
    bindingUri: vscode.Uri,
    symbolName: string,
    wordRange: vscode.Range,
  ): Promise<vscode.Hover | undefined> {
    
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
      `$(go-to-file) **Wails3 binding**\n\n` +
        `[Open Go definition (\`${goRelPath}:${goLine}\`)](${commandUri})`,
    );

    return new vscode.Hover(md, wordRange);
  }

  private parseBindingsImports(document: vscode.TextDocument, bindingsDir: string) {
    const text = document.getText();
    const results: Array<{ localName: string; specifier: string }> = [];
    

    // import * as Name from "...bindings..."
    const nsRegex = /import\s+\*\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*)\s+from\s+['"]([^'"]*)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = nsRegex.exec(text)) !== null) {
      
      if (this.specifierContainsBindings(m[2], bindingsDir)) {
        
        results.push({ localName: m[1], specifier: m[2] });
      }
    }

    // import { A, B } from "...bindings..."
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
          results.push({ localName: name, specifier: m[2] });
        }
      }
    }

    
    return results;
  }

  private specifierContainsBindings(specifier: string, bindingsDir: string): boolean {
    const segments = specifier.split("/");
    
    const result = segments.includes(bindingsDir);
    
    return result;
  }

  private async resolveBindingUri(
    document: vscode.TextDocument,
    specifier: string,
    symbolName: string,
  ): Promise<vscode.Uri | null> {
    const path = await import("path");
    const fs = await import("fs");
    
    let resolved = specifier;
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    
    
    
    // Handle path aliases like $lib/, @/, etc.
    const aliasMatch = specifier.match(/^(\$\w+|@\w*)\//);
    if (aliasMatch) {
      
      const alias = aliasMatch[1];
      if (workspaceFolder) {
        // Try to resolve the alias from tsconfig.json or svelte.config.js
        const aliasPath = resolvePathAlias(workspaceFolder.uri.fsPath, alias);
        if (aliasPath) {
          
          // Replace the alias with the resolved path
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
    let resolvedPath: string;
    if (path.isAbsolute(resolved)) {
      resolvedPath = resolved;
    } else {
      if (!workspaceFolder) {
        // Fall back to resolving relative to document
        const dir = path.dirname(document.uri.fsPath);
        resolvedPath = path.resolve(dir, resolved);
      } else {
        // Resolve relative to workspace root
        resolvedPath = path.resolve(workspaceFolder.uri.fsPath, resolved);
      }
    }
    
    

    // If it doesn't have a JS/TS extension, it's likely a directory import
    if (!/\.(js|ts|mjs|mts)$/.test(resolvedPath)) {
      const dirPath = resolvedPath;
      
      // First, try to access as file with extensions
      for (const ext of [".ts", ".js", ".d.ts"]) {
        const candidate = resolvedPath + ext;
        
        try {
          fs.accessSync(candidate);
          
          return vscode.Uri.file(candidate);
        } catch (err) {
          
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
          const candidate = resolvedPath + ext;
          
          try {
            fs.accessSync(candidate);
            resolvedPath = candidate;
            
            break;
          } catch {
            // continue
          }
        }
      } catch (err) {
        
      }
    }

    try {
      fs.accessSync(resolvedPath);
      
      return vscode.Uri.file(resolvedPath);
    } catch {
      
      return null;
    }
  }

  private escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
}

