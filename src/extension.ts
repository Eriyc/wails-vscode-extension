import * as vscode from 'vscode';
import { WailsDefinitionProvider } from './providers/wailsDefinitionProvider';

/**
 * Called when the extension is activated
 */
export function activate(context: vscode.ExtensionContext) {
  console.log('Wails3 Bindings Definition Provider is now active');

  // Register the definition provider for JavaScript and TypeScript files
  const selector: vscode.DocumentSelector = [
    { scheme: 'file', language: 'javascript' },
    { scheme: 'file', language: 'typescript' },
    { scheme: 'file', language: 'javascriptreact' },
    { scheme: 'file', language: 'typescriptreact' },
  ];

  const definitionProvider = new WailsDefinitionProvider();
  const disposable = vscode.languages.registerDefinitionProvider(
    selector,
    definitionProvider
  );

  context.subscriptions.push(disposable);
}

/**
 * Called when the extension is deactivated
 */
export function deactivate() {
  console.log('Wails3 Bindings Definition Provider is now deactivated');
}
