import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Provides "Go to Definition" functionality for Wails3 bindings.
 * Redirects from generated JS glue files to the original Go source files.
 */
export class WailsDefinitionProvider implements vscode.DefinitionProvider {
  /**
   * Provides the definition for the given position in the document.
   * 
   * @param document The document in which the command was invoked
   * @param position The position at which the command was invoked
   * @param token A cancellation token
   * @returns The definition location or undefined
   */
  provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.Definition | vscode.LocationLink[]> {
    const wordRange = document.getWordRangeAtPosition(position);
    if (!wordRange) {
      return undefined;
    }

    const word = document.getText(wordRange);
    const line = document.lineAt(position.line);
    const lineText = line.text;

    // Check if we're in a Wails bindings import or usage
    const bindingsMatch = this.detectWailsBinding(lineText, word);
    if (!bindingsMatch) {
      return undefined;
    }

    // Get the workspace folder
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!workspaceFolder) {
      return undefined;
    }

    // Get the bindings path from configuration
    const config = vscode.workspace.getConfiguration('wails');
    const bindingsPath = config.get<string>('bindingsPath', 'bindings');

    // Try to find the corresponding Go file
    const goDefinition = this.findGoDefinition(
      workspaceFolder.uri.fsPath,
      bindingsPath,
      bindingsMatch.packageName,
      bindingsMatch.functionName
    );

    return goDefinition;
  }

  /**
   * Detects if the current line contains a Wails binding reference
   * 
   * @param lineText The text of the current line
   * @param word The word at the cursor position
   * @returns Object with package and function names or undefined
   */
  private detectWailsBinding(
    lineText: string,
    word: string
  ): { packageName: string; functionName: string } | undefined {
    // Pattern 1: Import from bindings
    // import { Function } from './bindings/package'
    const importMatch = lineText.match(/from\s+['"]\.?\/?(.+?\/)?bindings\/([^'"]+)['"]/);
    if (importMatch) {
      const packageName = importMatch[2].replace(/\.js$/, '').replace(/\.ts$/, '');
      return { packageName, functionName: word };
    }

    // Pattern 2: Direct usage
    // bindings.package.Function()
    const usageMatch = lineText.match(/bindings\.([a-zA-Z0-9_]+)\.([a-zA-Z0-9_]+)/);
    if (usageMatch) {
      return { packageName: usageMatch[1], functionName: usageMatch[2] };
    }

    // Pattern 3: Destructured import usage
    // const { Function } = require('./bindings/package')
    const requireMatch = lineText.match(/require\(['"]\.?\/?(.+?\/)?bindings\/([^'"]+)['"]\)/);
    if (requireMatch) {
      const packageName = requireMatch[2].replace(/\.js$/, '').replace(/\.ts$/, '');
      return { packageName, functionName: word };
    }

    return undefined;
  }

  /**
   * Finds the Go source file and position for the given binding
   * 
   * @param workspacePath Root path of the workspace
   * @param bindingsPath Path to bindings directory
   * @param packageName Name of the Go package
   * @param functionName Name of the function
   * @returns Location of the Go definition or undefined
   */
  private findGoDefinition(
    workspacePath: string,
    bindingsPath: string,
    packageName: string,
    functionName: string
  ): vscode.Location | undefined {
    // Look for Go files in common locations
    const possiblePaths = [
      // Standard Wails3 structure
      path.join(workspacePath, packageName),
      path.join(workspacePath, 'internal', packageName),
      path.join(workspacePath, 'pkg', packageName),
      path.join(workspacePath, 'app', packageName),
      path.join(workspacePath, 'services', packageName),
    ];

    for (const dirPath of possiblePaths) {
      if (!fs.existsSync(dirPath)) {
        continue;
      }

      // Search for .go files in the directory
      const files = fs.readdirSync(dirPath);
      for (const file of files) {
        if (!file.endsWith('.go')) {
          continue;
        }

        const filePath = path.join(dirPath, file);
        const location = this.searchGoFile(filePath, functionName);
        if (location) {
          return location;
        }
      }
    }

    return undefined;
  }

  /**
   * Searches a Go file for a function definition
   * 
   * @param filePath Path to the Go file
   * @param functionName Name of the function to find
   * @returns Location of the function or undefined
   */
  private searchGoFile(
    filePath: string,
    functionName: string
  ): vscode.Location | undefined {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      // Look for function definition
      // Patterns: func (receiver) FunctionName(...) or func FunctionName(...)
      // Note: Go is case-sensitive, so we match exact case
      const functionRegex = new RegExp(
        `^func\\s+(\\([^)]+\\)\\s+)?${functionName}\\s*\\(`
      );

      for (let i = 0; i < lines.length; i++) {
        if (functionRegex.test(lines[i])) {
          const uri = vscode.Uri.file(filePath);
          const position = new vscode.Position(i, 0);
          const range = new vscode.Range(position, position);
          return new vscode.Location(uri, range);
        }
      }
    } catch (error) {
      // Ignore file read errors
    }

    return undefined;
  }
}
