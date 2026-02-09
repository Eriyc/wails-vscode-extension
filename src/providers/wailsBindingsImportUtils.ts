import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

/**
 * Import info extracted from a single import statement that references
 * a bindings path.
 */
export interface BindingsImport {
  /** The local name used in code (e.g. "GreetService"). */
  localName: string;
  /** Whether this is a namespace-like import where calls look like `X.Method(...)`. */
  isNamespace: boolean;
  /** The relative import specifier (e.g. "../bindings/changeme"). */
  specifier: string;
}

/**
 * Extract all import statements whose specifier contains the bindings dir.
 *
 * Handles:
 *   import { Foo, Bar as Baz } from "../bindings/pkg"
 *   import type { Foo } from "../bindings/pkg"           (TS)
 *   import * as Pkg from "../bindings/pkg"
 *   import Pkg from "../bindings/pkg"
 */
export function parseBindingsImports(
  document: vscode.TextDocument,
  bindingsDir: string,
): BindingsImport[] {
  const text = document.getText();
  const results: BindingsImport[] = [];

  // Namespace: import * as Name from "...bindings..."
  const nsRegex =
    /import\s+(?:type\s+)?\*\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*)\s+from\s+['"]([^'"]*)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = nsRegex.exec(text)) !== null) {
    if (specifierContainsBindings(m[2], bindingsDir)) {
      results.push({ localName: m[1], isNamespace: true, specifier: m[2] });
    }
  }

  // Named: import { A, B as C } from "...bindings..."
  const namedRegex =
    /import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"]([^'"]*)['"]/g;
  while ((m = namedRegex.exec(text)) !== null) {
    if (specifierContainsBindings(m[2], bindingsDir)) {
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
        // Named imports from bindings are treated as namespace-like because
        // they're typically service objects used as `Service.Method(...)`
        results.push({ localName: name, isNamespace: true, specifier: m[2] });
      }
    }
  }

  // Default: import Name from "...bindings..."
  // Note: This intentionally treats the default import as namespace-like because
  // most bindings are consumed as `Service.Method(...)`.
  const defaultRegex =
    /import\s+(?:type\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\s+from\s+['"]([^'"]*)['"]/g;
  while ((m = defaultRegex.exec(text)) !== null) {
    if (specifierContainsBindings(m[2], bindingsDir)) {
      results.push({ localName: m[1], isNamespace: true, specifier: m[2] });
    }
  }

  return results;
}

/** Check if an import specifier like `../bindings/changeme` contains the bindings dir segment. */
export function specifierContainsBindings(specifier: string, bindingsDir: string): boolean {
  const segments = specifier.split("/");
  return segments.includes(bindingsDir);
}

/**
 * Resolve an import specifier to a concrete file URI used as the binding file
 * for Go lookup.
 */
export function resolveBindingsSpecifier(
  document: vscode.TextDocument,
  specifier: string,
): vscode.Uri {
  const dir = path.dirname(document.uri.fsPath);
  let resolved = path.resolve(dir, specifier);

  // If it doesn't have a JS/TS extension, try common index files / extensions.
  if (!/\.(js|ts|mjs|mts)$/.test(resolved)) {
    for (const ext of ["/index.js", "/index.ts", ".js", ".ts"]) {
      const candidate = resolved + ext;
      try {
        fs.accessSync(candidate);
        resolved = candidate;
        break;
      } catch {
        // continue
      }
    }
  }

  return vscode.Uri.file(resolved);
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
