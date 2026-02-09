import * as vscode from "vscode";
import { WailsDefinitionProvider } from "./providers/wailsDefinitionProvider";
import { WailsCodeLensProvider } from "./providers/wailsCodeLensProvider";
import { WailsHoverProvider } from "./providers/wailsHoverProvider";
import { findGoDefinition, invalidateTaskfileCache } from "./providers/wailsBindingsUtils";

/**
 * Called when the extension is activated
 */
export function activate(context: vscode.ExtensionContext) {
  

  const selector: vscode.DocumentSelector = [
    { scheme: "file", language: "javascript" },
    { scheme: "file", language: "typescript" },
    { scheme: "file", language: "javascriptreact" },
    { scheme: "file", language: "typescriptreact" },
    { scheme: "file", language: "vue" },
    { scheme: "file", language: "svelte" },
  ];

  // Definition provider (adds Go result alongside built-in JS/TS result)
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(selector, new WailsDefinitionProvider()),
  );

  // CodeLens: "Go to Go implementation" above each exported function
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(selector, new WailsCodeLensProvider()),
  );

  // Hover: "Open Go definition" link on exported function names
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(selector, new WailsHoverProvider()),
  );

  // Watch Taskfile changes to invalidate the auto-detected bindings dir cache
  const taskfileWatcher = vscode.workspace.createFileSystemWatcher("**/Taskfile.{yml,yaml}");
  taskfileWatcher.onDidChange(() => invalidateTaskfileCache());
  taskfileWatcher.onDidCreate(() => invalidateTaskfileCache());
  taskfileWatcher.onDidDelete(() => invalidateTaskfileCache());
  context.subscriptions.push(taskfileWatcher);

  // Command: direct jump to Go source (used by CodeLens, hover link, and keybinding)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "wails.goToBackend",
      async (bindingUri?: vscode.Uri, symbolName?: string) => {
        // If invoked from the command palette without arguments, use the active editor
        if (!bindingUri || !symbolName) {
          const editor = vscode.window.activeTextEditor;
          if (!editor) {
            return;
          }
          bindingUri = editor.document.uri;
          const wordRange = editor.document.getWordRangeAtPosition(editor.selection.active);
          if (!wordRange) {
            vscode.window.showInformationMessage("Place the cursor on a symbol name.");
            return;
          }
          symbolName = editor.document.getText(wordRange);
        }

        const workspaceFolder = vscode.workspace.getWorkspaceFolder(bindingUri);
        if (!workspaceFolder) {
          return;
        }

        const location = await findGoDefinition(workspaceFolder, bindingUri, symbolName);
        if (!location) {
          vscode.window.showInformationMessage(`Could not find Go definition for "${symbolName}".`);
          return;
        }

        await vscode.window.showTextDocument(location.uri, {
          selection: location.range,
          preview: false,
        });
      },
    ),
  );
}

/**
 * Called when the extension is deactivated
 */
export function deactivate() {
  
}
