import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

// ---------------------------------------------------------------------------
// Bindings detection
// ---------------------------------------------------------------------------

/**
 * Cache for the auto-detected bindings directory per workspace folder.
 * Cleared when the setting changes or when a Taskfile is modified.
 */
const taskfileBindingsCache = new Map<string, string | null>();

/**
 * Parse a Taskfile.yml/Taskfile.yaml in the given workspace folder and
 * extract the bindings output directory from the `generate:bindings` task.
 *
 * Detection order:
 *   1. `-d <path>` or `-dir <path>` flag in the `wails3 generate bindings` command
 *   2. `generates:` entries whose glob contains a recognisable directory path
 *   3. Returns `null` if nothing is found
 */
function detectBindingsDirFromTaskfile(workspacePath: string): string | null {
  for (const name of ["Taskfile.yml", "Taskfile.yaml"]) {
    const taskfilePath = path.join(workspacePath, name);
    if (!fs.existsSync(taskfilePath)) {
      // Also check inside a build/ subdirectory (common wails layout)
      const buildPath = path.join(workspacePath, "build", name);
      if (!fs.existsSync(buildPath)) {
        continue;
      }
      return parseTaskfileForBindingsDir(buildPath);
    }
    return parseTaskfileForBindingsDir(taskfilePath);
  }
  return null;
}

/**
 * Read and parse a single Taskfile for the wails3 generate bindings command.
 * This is a lightweight line-based parser — just enough to extract the `-d` flag
 * without pulling in a full YAML library.
 */
function parseTaskfileForBindingsDir(taskfilePath: string): string | null {
  try {
    const content = fs.readFileSync(taskfilePath, "utf-8");
    const lines = content.split("\n");

    let inGenerateBindings = false;
    let inCmds = false;
    let inGenerates = false;

    for (const rawLine of lines) {
      const trimmed = rawLine.trim();

      // Detect the generate:bindings task block
      if (
        trimmed.startsWith("generate:bindings:") ||
        /^['"]?generate:bindings['"]?:/.test(trimmed)
      ) {
        inGenerateBindings = true;
        inCmds = false;
        inGenerates = false;
        continue;
      }

      // Exit the task block when we hit another top-level task
      if (
        inGenerateBindings &&
        /^[A-Za-z]/.test(rawLine) &&
        /:/.test(trimmed) &&
        !trimmed.startsWith("-")
      ) {
        inGenerateBindings = false;
        inCmds = false;
        inGenerates = false;
        continue;
      }

      if (!inGenerateBindings) {
        continue;
      }

      // Track sub-sections
      if (/^\s+cmds:/.test(rawLine)) {
        inCmds = true;
        inGenerates = false;
        continue;
      }
      if (/^\s+generates:/.test(rawLine)) {
        inGenerates = true;
        inCmds = false;
        continue;
      }
      if (/^\s+\w+:/.test(rawLine) && !inCmds && !inGenerates) {
        inCmds = false;
        inGenerates = false;
      }

      // 1. Look for -d / -dir in the wails3 generate bindings command
      if (inCmds && /wails3\s+generate\s+bindings/.test(trimmed)) {
        // Match -d <path> or -dir <path> (possibly quoted)
        const dirMatch = trimmed.match(/\s-(?:d|dir)\s+['"]?([^\s'"]+)['"]?/);
        if (dirMatch) {
          return dirMatch[1];
        }
      }

      // 2. Fallback: parse generates entries like `frontend/bindings/**/*`
      if (inGenerates && trimmed.startsWith("-")) {
        const entry = trimmed.replace(/^-\s*['"]?/, "").replace(/['"]?\s*$/, "");
        // Skip exclude entries
        if (entry.startsWith("exclude:")) {
          continue;
        }
        // Strip glob suffixes: frontend/bindings/**/* → frontend/bindings
        const cleaned = entry.replace(/\/?\*\*\/?\*?$/, "").replace(/\/\*$/, "");
        if (cleaned && cleaned.includes("/")) {
          // Return the last directory segment name
          const lastSeg = path.basename(cleaned);
          if (lastSeg) {
            return lastSeg;
          }
        }
      }
    }
  } catch {
    // Couldn't read/parse Taskfile — fall through
  }
  return null;
}

/**
 * Returns true when `filePath` sits under a directory whose name matches
 * `bindingsDir`. Supports two forms:
 *
 * - **Simple name** (e.g. `"bindings"`): checks if any path segment matches.
 * - **Relative path** (e.g. `"frontend/src/lib/bindings"`): checks if the
 *   relative path from the workspace root contains that subpath.
 */
export function isInsideBindingsDir(
  filePath: string,
  workspacePath: string,
  bindingsDir: string,
): boolean {
  const relative = path.relative(workspacePath, filePath).split(path.sep).join("/");

  if (bindingsDir.includes("/")) {
    // Full relative path: check if the file path contains this subpath
    const normalised = bindingsDir.replace(/\\/g, "/").replace(/\/$/, "");
    return relative.startsWith(normalised + "/") || relative === normalised;
  }

  // Simple segment name
  const segments = relative.split("/");
  return segments.includes(bindingsDir);
}

/**
 * Read the configured bindings directory name.
 *
 * Resolution order:
 *   1. The explicit `wails.bindingsPath` VS Code setting (if changed from default).
 *   2. Auto-detected from `Taskfile.yml` (`-d` flag on `wails3 generate bindings`).
 *   3. Falls back to `"bindings"`.
 */
export function getBindingsDir(workspaceFolder?: vscode.WorkspaceFolder): string {
  const config = vscode.workspace.getConfiguration("wails");
  const configured = config.get<string>("bindingsPath", "bindings");

  // If the user explicitly set a non-default value, honour it
  const inspected = config.inspect<string>("bindingsPath");
  const isExplicitlySet =
    inspected?.workspaceValue !== undefined ||
    inspected?.workspaceFolderValue !== undefined ||
    inspected?.globalValue !== undefined;

  if (isExplicitlySet) {
    return configured;
  }

  // Try auto-detect from Taskfile
  const wsPath = workspaceFolder?.uri.fsPath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (wsPath) {
    if (taskfileBindingsCache.has(wsPath)) {
      const cached = taskfileBindingsCache.get(wsPath);
      if (cached) {
        return cached;
      }
    } else {
      const detected = detectBindingsDirFromTaskfile(wsPath);
      taskfileBindingsCache.set(wsPath, detected);
      if (detected) {
        return detected;
      }
    }
  }

  return configured;
}

/**
 * Invalidate the Taskfile auto-detection cache. Should be called when
 * a Taskfile in the workspace changes.
 */
export function invalidateTaskfileCache(workspacePath?: string): void {
  if (workspacePath) {
    taskfileBindingsCache.delete(workspacePath);
  } else {
    taskfileBindingsCache.clear();
  }
}

// ---------------------------------------------------------------------------
// Go source lookup
// ---------------------------------------------------------------------------

/**
 * Given a bindings file URI and a symbol name, find the matching Go source.
 *
 * Lookup order:
 *   1. Go files whose stem matches the bindings filename
 *      (e.g. greetservice.js -> greetservice.go).
 *   2. All .go files in the workspace (broad fallback).
 */
export async function findGoDefinition(
  workspaceFolder: vscode.WorkspaceFolder,
  bindingUri: vscode.Uri,
  symbolName: string,
): Promise<vscode.Location | undefined> {
  const stem = path.basename(bindingUri.fsPath).replace(/(\.(d\.ts|js|ts))$/, "");
  const goFileName = `${stem}.go`;
  const bindingsDir = getBindingsDir(workspaceFolder);

  // 1. Exact filename match
  const candidates = await vscode.workspace.findFiles(
    new vscode.RelativePattern(workspaceFolder, `**/${goFileName}`),
    "**/node_modules/**",
  );

  const goFiles = candidates.filter(
    (uri) => !isInsideBindingsDir(uri.fsPath, workspaceFolder.uri.fsPath, bindingsDir),
  );

  for (const goFileUri of goFiles) {
    const loc = searchGoFileForSymbol(goFileUri, symbolName);
    if (loc) {
      return loc;
    }
  }

  // 2. Broad fallback: search all Go files
  const allGoFiles = await vscode.workspace.findFiles(
    new vscode.RelativePattern(workspaceFolder, "**/*.go"),
    "**/node_modules/**",
  );

  const filteredGoFiles = allGoFiles.filter(
    (uri) =>
      !isInsideBindingsDir(uri.fsPath, workspaceFolder.uri.fsPath, bindingsDir) &&
      !goFiles.some((g) => g.fsPath === uri.fsPath),
  );

  for (const goFileUri of filteredGoFiles) {
    const loc = searchGoFileForSymbol(goFileUri, symbolName);
    if (loc) {
      return loc;
    }
  }

  return undefined;
}

/**
 * Scans a single Go file for a definition of `symbolName`.
 *
 * Matches:
 *   - func (recv) SymbolName(...)   -- method
 *   - func SymbolName(...)          -- plain function
 *   - type SymbolName struct/interface/... -- type definition
 */
export function searchGoFileForSymbol(
  goFileUri: vscode.Uri,
  symbolName: string,
): vscode.Location | undefined {
  try {
    const content = fs.readFileSync(goFileUri.fsPath, "utf-8");
    const lines = content.split("\n");

    const escaped = escapeRegExp(symbolName);
    const funcRegex = new RegExp(`^func\\s+(\\([^)]+\\)\\s+)?${escaped}\\s*\\(`);
    const typeRegex = new RegExp(`^type\\s+${escaped}\\s+`);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (funcRegex.test(line) || typeRegex.test(line)) {
        const col = line.indexOf(symbolName);
        const pos = new vscode.Position(i, col >= 0 ? col : 0);
        return new vscode.Location(goFileUri, pos);
      }
    }
  } catch {
    // file read error -- skip
  }

  return undefined;
}

/**
 * Parse a Wails3 auto-generated bindings JS/TS file and return all exported
 * function names (the symbols that should be redirected to Go).
 */
export function parseBindingExports(document: vscode.TextDocument): string[] {
  const text = document.getText();
  const exports: string[] = [];
  const regex = /^export\s+function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/gm;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    exports.push(match[1]);
  }
  return exports;
}

/**
 * Returns true if the document looks like a Wails3 auto-generated bindings
 * file (contains the Welsh auto-gen comment).
 */
export function isWailsBindingsFile(document: vscode.TextDocument): boolean {
  // The Wails3 code generator always emits this comment in the first few lines
  const header = document.getText(new vscode.Range(0, 0, 5, 0));
  return header.includes("Cynhyrchwyd y ffeil hon yn awtomatig");
}

/** Escape special regex characters. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
