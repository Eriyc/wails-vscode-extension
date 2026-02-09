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
    if (fs.existsSync(taskfilePath)) {
      const result = parseTaskfileForBindingsDir(taskfilePath);
      // If we found something in the root Taskfile, return it
      if (result) {
        return result;
      }
      // If root Taskfile exists but didn't have the bindings command, 
      // continue to check build/ subdirectory
    }

    // Check inside a build/ subdirectory (common wails layout)
    const buildPath = path.join(workspacePath, "build", name);
    if (fs.existsSync(buildPath)) {
      const result = parseTaskfileForBindingsDir(buildPath);
      if (result) {
        return result;
      }
    }
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

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const rawLine = lines[lineNum];
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
          // Return the full path, not just the last segment
          return cleaned;
        }
      }
    }
  } catch (error) {
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
 * Get the full relative path to the bindings directory from the workspace root.
 * For example, returns "frontend/src/lib/bindings" instead of just "bindings".
 * 
 * Resolution order:
 *   1. The explicit `wails.bindingsPath` VS Code setting (if changed from default).
 *   2. Auto-detected from `Taskfile.yml` (`-d` flag on `wails3 generate bindings`).
 *   3. Falls back to `"bindings"`.
 */
export function getFullBindingsPath(workspaceFolder?: vscode.WorkspaceFolder): string {
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
      // Cache had null, which means a previous detection failed. 
      // Don't return here, let it fall through to try again.
    }
    
    // Either no cache entry, or cache had null - try detection
    const detected = detectBindingsDirFromTaskfile(wsPath);
    if (detected) {
      // Only cache successful detections
      taskfileBindingsCache.set(wsPath, detected);
      return detected;
    }
    // Don't cache null results - leave cache entry missing so we retry next time
  }

  return configured;
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
 * When an index file is encountered, try to find the actual file that contains
 * the symbol by searching sibling files in the same directory.
 */
function resolveReExportFromIndex(indexUri: vscode.Uri, symbolName: string): vscode.Uri | null {
  try {
    const indexDir = path.dirname(indexUri.fsPath);
    const files = fs.readdirSync(indexDir);
    
    // Look for JS/TS files in the same directory (excluding index itself)
    for (const file of files) {
      if (file === 'index.js' || file === 'index.ts' || file === 'index.d.ts') {
        continue;
      }
      
      if (/\.(js|ts)$/.test(file) && !file.endsWith('.d.ts')) {
        const filePath = path.join(indexDir, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        
        // Check if this file exports the symbol we're looking for
        const exportRegex = new RegExp(`export\\s+function\\s+${symbolName}\\s*\\(`);
        if (exportRegex.test(content)) {
          
          return vscode.Uri.file(filePath);
        }
      }
    }
  } catch (error) {
    console.error('[Wails] Error resolving re-export:', error);
  }
  
  return null;
}

/**
 * Given a bindings file URI and a symbol name, find the matching Go source.
 *
 * Strategy: construct the Go source path directly from the bindings path structure.
 * The bindings directory mirrors the Go package structure, so we can derive the
 * source location without expensive workspace searches.
 *
 * Example:
 *   - Bindings: frontend/bindings/changeme/greetservice.js
 *   - Go module: changeme (from go.mod)
 *   - Source: greetservice.go (at project root)
 */
export async function findGoDefinition(
  workspaceFolder: vscode.WorkspaceFolder,
  bindingUri: vscode.Uri,
  symbolName: string,
): Promise<vscode.Location | undefined> {
  const stem = path.basename(bindingUri.fsPath).replace(/(\.(d\.ts|js|ts))$/, "");
  
  // If this is an index file, try to resolve the re-export
  if (stem === 'index') {
    const actualBindingUri = resolveReExportFromIndex(bindingUri, symbolName);
    if (actualBindingUri) {
      // Recursively call with the actual file
      return findGoDefinition(workspaceFolder, actualBindingUri, symbolName);
    }
    return undefined;
  }
  
  const goFileName = `${stem}.go`;

  // Extract package path from bindings directory structure
  let goFilePath = constructGoFilePath(workspaceFolder.uri.fsPath, bindingUri.fsPath, goFileName);

  if (goFilePath && fs.existsSync(goFilePath)) {
    const goFileUri = vscode.Uri.file(goFilePath);
    const loc = searchGoFileForSymbol(goFileUri, symbolName);
    if (loc) {
      return loc;
    }
  } else {
    // Fallback: try using the parent directory name as the filename
    // E.g., if binding is "session/manager.ts", try "session.go" instead of "manager.go"
    const bindingDir = path.dirname(bindingUri.fsPath);
    const parentDirName = path.basename(bindingDir);
    
    if (parentDirName !== stem) {
      const fallbackGoFileName = `${parentDirName}.go`;
      goFilePath = constructGoFilePath(workspaceFolder.uri.fsPath, bindingUri.fsPath, fallbackGoFileName);
      
      if (goFilePath && fs.existsSync(goFilePath)) {
        const goFileUri = vscode.Uri.file(goFilePath);
        const loc = searchGoFileForSymbol(goFileUri, symbolName);
        if (loc) {
          return loc;
        }
      }
    }
  }

  // Final fallback: if direct path construction fails, do a limited search
  // Search only in common Go source directories, excluding common false-positive locations
  const bindingsDir = getBindingsDir(workspaceFolder);
  const candidates = await vscode.workspace.findFiles(
    new vscode.RelativePattern(workspaceFolder, `**/${goFileName}`),
    `{**/node_modules/**,**/.direnv/**,**/vendor/**,**/${bindingsDir}/**}`,
  );

  for (const goFileUri of candidates) {
    const loc = searchGoFileForSymbol(goFileUri, symbolName);
    if (loc) {
      return loc;
    }
  }

  return undefined;
}

/**
 * Construct the Go source file path from the bindings file path.
 *
 * The bindings directory structure mirrors Go packages:
 *   - bindings/changeme/service.js -> service.go (in project root)
 *   - bindings/changeme/pkg/service.js -> pkg/service.go (in subdirectory)
 *   - bindings/github.com/user/pkg/service.js -> external package (skip)
 */
function constructGoFilePath(
  workspacePath: string,
  bindingsFilePath: string,
  goFileName: string,
): string | null {
  try {
    // Find go.mod by traversing up from the bindings file
    const goModPath = findGoModFileFromPath(bindingsFilePath, workspacePath);
    if (!goModPath) {
      return null;
    }

    const projectRoot = path.dirname(goModPath);
    const moduleName = parseModuleName(goModPath);
    if (!moduleName) {
      return null;
    }

    // Extract the package path from the bindings file path
    const bindingsDir = getBindingsDir();
    const relativePath = path.relative(projectRoot, bindingsFilePath);
    const segments = relativePath.split(path.sep);

    // Find the bindings directory in the path
    // bindingsDir might be a full path like "frontend/src/lib/bindings"
    // so we need to find where those segments match in sequence
    const bindingsSegments = bindingsDir.split('/');
    let bindingsIndex = -1;
    
    for (let i = 0; i <= segments.length - bindingsSegments.length; i++) {
      let match = true;
      for (let j = 0; j < bindingsSegments.length; j++) {
        if (segments[i + j] !== bindingsSegments[j]) {
          match = false;
          break;
        }
      }
      if (match) {
        bindingsIndex = i;
        break;
      }
    }
    
    if (bindingsIndex === -1) {
      return null;
    }

    // Get package path after bindings directory (e.g., "changeme/pkg" or "changeme")
    const packageSegments = segments.slice(bindingsIndex + bindingsSegments.length, -1); // Exclude filename

    if (packageSegments.length === 0) {
      return null;
    }

    // Check if this is the main module or a subpackage
    const firstSegment = packageSegments[0];

    // Skip truly external packages (e.g., "github.com" when module is "changeme")
    // But if the module itself starts with "github.com", we should match the full path
    const moduleSegments = moduleName.split('/');
    
    // Check if packageSegments starts with the module path
    let isOwnModule = false;
    if (packageSegments.length >= moduleSegments.length) {
      let match = true;
      for (let i = 0; i < moduleSegments.length; i++) {
        if (packageSegments[i] !== moduleSegments[i]) {
          match = false;
          break;
        }
      }
      if (match) {
        isOwnModule = true;
      }
    }
    
    if (!isOwnModule && firstSegment.includes(".")) {
      return null;
    }

    if (isOwnModule) {
      // Extract path after module name
      const subPath = packageSegments.slice(moduleSegments.length);
      if (subPath.length === 0) {
        return null;
      }
      const result = path.join(projectRoot, ...subPath, goFileName);
      return result;
    }

    // If first segment matches module name, construct path relative to project root
    const moduleBaseName = path.basename(moduleName);
    if (firstSegment === moduleBaseName || firstSegment === moduleName) {
      // Remove the module name segment and build the path
      const subPath = packageSegments.slice(1);
      const result = path.join(projectRoot, ...subPath, goFileName);
      return result;
    }

    // Otherwise, it might be a subdirectory under the project
    const result = path.join(projectRoot, ...packageSegments, goFileName);
    return result;
  } catch (error) {
    return null;
  }
}

/**
 * Find the go.mod file by traversing up from a starting path.
 * Stops at the workspace boundary to avoid going outside the project.
 */
function findGoModFileFromPath(startPath: string, workspacePath: string): string | null {
  let currentDir = path.dirname(startPath);
  const workspaceNormalized = path.resolve(workspacePath);

  // Traverse up the directory tree
  while (currentDir.startsWith(workspaceNormalized)) {
    const goModPath = path.join(currentDir, "go.mod");
    if (fs.existsSync(goModPath)) {
      return goModPath;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      // Reached filesystem root
      break;
    }
    currentDir = parentDir;
  }

  return null;
}

/**
 * Parse the module name from go.mod file.
 */
function parseModuleName(goModPath: string): string | null {
  try {
    const content = fs.readFileSync(goModPath, "utf-8");
    const match = content.match(/^module\s+(.+)$/m);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
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
  } catch (error) {
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
