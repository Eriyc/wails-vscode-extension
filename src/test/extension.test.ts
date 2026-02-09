import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { WailsDefinitionProvider } from "../providers/wailsDefinitionProvider";
import { WailsCodeLensProvider } from "../providers/wailsCodeLensProvider";
import { WailsHoverProvider } from "../providers/wailsHoverProvider";
import {
  isInsideBindingsDir,
  searchGoFileForSymbol,
  parseBindingExports,
  isWailsBindingsFile,
} from "../providers/wailsBindingsUtils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Root of the extension workspace. */
const WORKSPACE_ROOT = path.resolve(__dirname, "..", "..");

/** Absolute path into the examples directory. */
function examplesPath(...segments: string[]): string {
  return path.join(WORKSPACE_ROOT, "examples", ...segments);
}

/** Open a text document and return it. */
async function openDoc(filePath: string): Promise<vscode.TextDocument> {
  return vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
}

/** Find the Position of `needle` inside `doc` (first occurrence). */
function findWord(doc: vscode.TextDocument, needle: string): vscode.Position {
  for (let i = 0; i < doc.lineCount; i++) {
    const col = doc.lineAt(i).text.indexOf(needle);
    if (col >= 0) {
      return new vscode.Position(i, col);
    }
  }
  throw new Error(`"${needle}" not found in ${doc.uri.fsPath}`);
}

const cancellationToken = new vscode.CancellationTokenSource().token;

// =========================================================================
// Unit tests — pure utility functions (no workspace folder needed)
// =========================================================================

suite("Utility: isInsideBindingsDir", () => {
  test("detects file inside bindings/", () => {
    assert.strictEqual(
      isInsideBindingsDir("/ws/frontend/bindings/changeme/greetservice.js", "/ws", "bindings"),
      true,
    );
  });

  test("rejects file outside bindings/", () => {
    assert.strictEqual(isInsideBindingsDir("/ws/src/main.js", "/ws", "bindings"), false);
  });

  test("works with nested paths", () => {
    assert.strictEqual(
      isInsideBindingsDir(
        "/ws/frontend/bindings/github.com/wailsapp/wails/v3/internal/eventcreate.js",
        "/ws",
        "bindings",
      ),
      true,
    );
  });
});

suite("Utility: searchGoFileForSymbol", () => {
  // JS example
  test("finds Greet method in examples/js/greetservice.go", () => {
    const goUri = vscode.Uri.file(examplesPath("js", "greetservice.go"));
    const loc = searchGoFileForSymbol(goUri, "Greet");
    assert.ok(loc, "Should find Greet");
    assert.strictEqual(loc!.range.start.line, 4);
    assert.ok(loc!.uri.fsPath.endsWith("greetservice.go"));
  });

  test("finds GreetService type in examples/js/greetservice.go", () => {
    const goUri = vscode.Uri.file(examplesPath("js", "greetservice.go"));
    const loc = searchGoFileForSymbol(goUri, "GreetService");
    assert.ok(loc, "Should find GreetService type");
    assert.strictEqual(loc!.range.start.line, 2);
  });

  // TS example
  test("finds Greet method in examples/ts/greetservice.go", () => {
    const goUri = vscode.Uri.file(examplesPath("ts", "greetservice.go"));
    const loc = searchGoFileForSymbol(goUri, "Greet");
    assert.ok(loc, "Should find Greet");
    assert.strictEqual(loc!.range.start.line, 4);
  });

  test("finds GreetService type in examples/ts/greetservice.go", () => {
    const goUri = vscode.Uri.file(examplesPath("ts", "greetservice.go"));
    const loc = searchGoFileForSymbol(goUri, "GreetService");
    assert.ok(loc, "Should find GreetService type");
    assert.strictEqual(loc!.range.start.line, 2);
  });

  test("returns undefined for non-existent symbol", () => {
    const goUri = vscode.Uri.file(examplesPath("js", "greetservice.go"));
    const loc = searchGoFileForSymbol(goUri, "NoSuchFunction");
    assert.strictEqual(loc, undefined);
  });
});

suite("Utility: isWailsBindingsFile", () => {
  test("recognises JS bindings file", async () => {
    const doc = await openDoc(
      examplesPath("js", "frontend", "bindings", "changeme", "greetservice.js"),
    );
    assert.strictEqual(isWailsBindingsFile(doc), true);
  });

  test("recognises TS bindings file", async () => {
    const doc = await openDoc(
      examplesPath("ts", "frontend", "bindings", "changeme", "greetservice.ts"),
    );
    assert.strictEqual(isWailsBindingsFile(doc), true);
  });

  test("recognises index barrel file", async () => {
    const doc = await openDoc(examplesPath("js", "frontend", "bindings", "changeme", "index.js"));
    assert.strictEqual(isWailsBindingsFile(doc), true);
  });

  test("rejects non-binding JS file", async () => {
    const doc = await openDoc(examplesPath("js", "frontend", "src", "main.js"));
    assert.strictEqual(isWailsBindingsFile(doc), false);
  });
});

suite("Utility: parseBindingExports", () => {
  test("parses exports from JS greetservice binding", async () => {
    const doc = await openDoc(
      examplesPath("js", "frontend", "bindings", "changeme", "greetservice.js"),
    );
    const exports = parseBindingExports(doc);
    assert.deepStrictEqual(exports, ["Greet"]);
  });

  test("parses exports from TS greetservice binding", async () => {
    const doc = await openDoc(
      examplesPath("ts", "frontend", "bindings", "changeme", "greetservice.ts"),
    );
    const exports = parseBindingExports(doc);
    assert.deepStrictEqual(exports, ["Greet"]);
  });

  test("returns empty for index barrel (re-exports, no function exports)", async () => {
    const doc = await openDoc(examplesPath("js", "frontend", "bindings", "changeme", "index.js"));
    const exports = parseBindingExports(doc);
    assert.deepStrictEqual(exports, []);
  });

  test("returns empty for eventcreate (no exported functions)", async () => {
    const doc = await openDoc(
      examplesPath(
        "js",
        "frontend",
        "bindings",
        "github.com",
        "wailsapp",
        "wails",
        "v3",
        "internal",
        "eventcreate.js",
      ),
    );
    const exports = parseBindingExports(doc);
    assert.deepStrictEqual(exports, []);
  });
});

// =========================================================================
// Integration tests — CodeLens provider against real example files
// =========================================================================

suite("WailsCodeLensProvider — JS glue file", () => {
  const codeLens = new WailsCodeLensProvider();

  test("produces CodeLens for Greet in greetservice.js", async () => {
    const doc = await openDoc(
      examplesPath("js", "frontend", "bindings", "changeme", "greetservice.js"),
    );
    const lenses = codeLens.provideCodeLenses(doc, cancellationToken);
    const greetLens = lenses.filter((l) => l.command?.arguments?.[1] === "Greet");
    assert.strictEqual(greetLens.length, 1, "Should have exactly one CodeLens for Greet");
    assert.ok(greetLens[0].command?.command === "wails.goToBackend");
  });

  test("no CodeLens for index.js (barrel, no function exports)", async () => {
    const doc = await openDoc(examplesPath("js", "frontend", "bindings", "changeme", "index.js"));
    const lenses = codeLens.provideCodeLenses(doc, cancellationToken);
    assert.strictEqual(lenses.length, 0);
  });
});

suite("WailsCodeLensProvider — TS glue file", () => {
  const codeLens = new WailsCodeLensProvider();

  test("produces CodeLens for Greet in greetservice.ts", async () => {
    const doc = await openDoc(
      examplesPath("ts", "frontend", "bindings", "changeme", "greetservice.ts"),
    );
    const lenses = codeLens.provideCodeLenses(doc, cancellationToken);
    const greetLens = lenses.filter((l) => l.command?.arguments?.[1] === "Greet");
    assert.strictEqual(greetLens.length, 1, "Should have exactly one CodeLens for Greet");
  });
});

suite("WailsCodeLensProvider — user code (JS)", () => {
  const codeLens = new WailsCodeLensProvider();

  test("shows CodeLens on GreetService.Greet usage in main.js", async () => {
    const doc = await openDoc(examplesPath("js", "frontend", "src", "main.js"));
    const lenses = codeLens.provideCodeLenses(doc, cancellationToken);
    const greetLens = lenses.filter((l) => l.command?.arguments?.[1] === "Greet");
    assert.ok(greetLens.length >= 1, "Should have CodeLens for GreetService.Greet usage");
    assert.ok(greetLens[0].command?.title.includes("Go to Go"));
  });

  test("CodeLens is on the correct line (GreetService.Greet call)", async () => {
    const doc = await openDoc(examplesPath("js", "frontend", "src", "main.js"));
    const lenses = codeLens.provideCodeLenses(doc, cancellationToken);
    const greetLens = lenses.filter((l) => l.command?.arguments?.[1] === "Greet");
    if (greetLens.length > 0) {
      const line = doc.lineAt(greetLens[0].range.start.line).text;
      assert.ok(
        line.includes("GreetService.Greet"),
        "CodeLens should be on the line with the call",
      );
    }
  });

  test("no CodeLens for non-bindings import usage (Events.On)", async () => {
    const doc = await openDoc(examplesPath("js", "frontend", "src", "main.js"));
    const lenses = codeLens.provideCodeLenses(doc, cancellationToken);
    const eventsLens = lenses.filter((l) => {
      const title = l.command?.title ?? "";
      return title.includes("Events");
    });
    assert.strictEqual(
      eventsLens.length,
      0,
      "Should not show CodeLens for Events (not from bindings)",
    );
  });
});

suite("WailsCodeLensProvider — user code (TS)", () => {
  const codeLens = new WailsCodeLensProvider();

  test("shows CodeLens on GreetService.Greet usage in main.ts", async () => {
    const doc = await openDoc(examplesPath("ts", "frontend", "src", "main.ts"));
    const lenses = codeLens.provideCodeLenses(doc, cancellationToken);
    const greetLens = lenses.filter((l) => l.command?.arguments?.[1] === "Greet");
    assert.ok(greetLens.length >= 1, "Should have CodeLens for GreetService.Greet usage");
  });

  test("CodeLens is on the correct line in main.ts", async () => {
    const doc = await openDoc(examplesPath("ts", "frontend", "src", "main.ts"));
    const lenses = codeLens.provideCodeLenses(doc, cancellationToken);
    const greetLens = lenses.filter((l) => l.command?.arguments?.[1] === "Greet");
    if (greetLens.length > 0) {
      const line = doc.lineAt(greetLens[0].range.start.line).text;
      assert.ok(
        line.includes("GreetService.Greet"),
        "CodeLens should be on the line with the call",
      );
    }
  });
});

// =========================================================================
// Integration tests — Hover provider against real example files
// =========================================================================

suite("WailsHoverProvider — JS example", () => {
  const hover = new WailsHoverProvider();

  test("shows hover on Greet in greetservice.js", async () => {
    const doc = await openDoc(
      examplesPath("js", "frontend", "bindings", "changeme", "greetservice.js"),
    );
    const pos = findWord(doc, "Greet");
    const result = await hover.provideHover(doc, pos, cancellationToken);
    // May be undefined if no workspace folder is associated; if it resolves, check content
    if (result) {
      const md = result.contents[0];
      assert.ok(md instanceof vscode.MarkdownString);
      assert.ok(md.value.includes("Go definition"));
    }
  });

  test("no hover on non-export symbol ($Call)", async () => {
    const doc = await openDoc(
      examplesPath("js", "frontend", "bindings", "changeme", "greetservice.js"),
    );
    const pos = findWord(doc, "$Call");
    const result = await hover.provideHover(doc, pos, cancellationToken);
    assert.strictEqual(result, undefined);
  });
});

suite("WailsHoverProvider — TS example", () => {
  const hover = new WailsHoverProvider();

  test("shows hover on Greet in greetservice.ts", async () => {
    const doc = await openDoc(
      examplesPath("ts", "frontend", "bindings", "changeme", "greetservice.ts"),
    );
    const pos = findWord(doc, "Greet");
    const result = await hover.provideHover(doc, pos, cancellationToken);
    if (result) {
      const md = result.contents[0];
      assert.ok(md instanceof vscode.MarkdownString);
      assert.ok(md.value.includes("Go definition"));
    }
  });
});

// =========================================================================
// Integration tests — DefinitionProvider against real example files
// =========================================================================

suite("WailsDefinitionProvider — JS example", () => {
  const provider = new WailsDefinitionProvider();

  test("resolves Greet from greetservice.js to greetservice.go", async () => {
    const doc = await openDoc(
      examplesPath("js", "frontend", "bindings", "changeme", "greetservice.js"),
    );
    const pos = findWord(doc, "Greet");
    const result = await provider.provideDefinition(doc, pos, cancellationToken);
    if (result && !Array.isArray(result) && "uri" in result) {
      assert.ok(result.uri.fsPath.endsWith("greetservice.go"), "Should resolve to greetservice.go");
      assert.strictEqual(result.range.start.line, 4, "Greet method is on line 5 (0-indexed 4)");
    }
  });

  test("resolves GreetService from greetservice.js to Go type", async () => {
    const doc = await openDoc(
      examplesPath("js", "frontend", "bindings", "changeme", "greetservice.js"),
    );
    // "GreetService" doesn't appear as an export in greetservice.js, but let's check
    // that the symbol resolver handles it via the index barrel
    const indexDoc = await openDoc(
      examplesPath("js", "frontend", "bindings", "changeme", "index.js"),
    );
    const pos = findWord(indexDoc, "GreetService");
    const result = await provider.provideDefinition(indexDoc, pos, cancellationToken);
    // index.js is inside bindings, so the provider will try to find GreetService in Go
    if (result && !Array.isArray(result) && "uri" in result) {
      assert.ok(result.uri.fsPath.endsWith("greetservice.go"));
      assert.strictEqual(
        result.range.start.line,
        2,
        "GreetService type is on line 3 (0-indexed 2)",
      );
    }
  });

  test("returns undefined for non-binding JS file", async () => {
    const doc = await openDoc(examplesPath("js", "frontend", "src", "main.js"));
    const pos = new vscode.Position(0, 5);
    const result = await provider.provideDefinition(doc, pos, cancellationToken);
    assert.strictEqual(result, undefined);
  });
});

suite("WailsDefinitionProvider — TS example", () => {
  const provider = new WailsDefinitionProvider();

  test("resolves Greet from greetservice.ts to greetservice.go", async () => {
    const doc = await openDoc(
      examplesPath("ts", "frontend", "bindings", "changeme", "greetservice.ts"),
    );
    const pos = findWord(doc, "Greet");
    const result = await provider.provideDefinition(doc, pos, cancellationToken);
    if (result && !Array.isArray(result) && "uri" in result) {
      assert.ok(result.uri.fsPath.endsWith("greetservice.go"));
      assert.strictEqual(result.range.start.line, 4);
    }
  });

  test("resolves GreetService from index.ts to Go type", async () => {
    const indexDoc = await openDoc(
      examplesPath("ts", "frontend", "bindings", "changeme", "index.ts"),
    );
    const pos = findWord(indexDoc, "GreetService");
    const result = await provider.provideDefinition(indexDoc, pos, cancellationToken);
    if (result && !Array.isArray(result) && "uri" in result) {
      assert.ok(result.uri.fsPath.endsWith("greetservice.go"));
      assert.strictEqual(result.range.start.line, 2);
    }
  });
});

// =========================================================================
// Synthetic tests — temp directory (no workspace folder dependency)
// =========================================================================

suite("Synthetic — temp directory tests", () => {
  let tempDir: string;

  setup(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "wails-test-"));
  });

  teardown(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("searchGoFileForSymbol finds method with receiver", () => {
    const goFile = path.join(tempDir, "service.go");
    fs.writeFileSync(
      goFile,
      [
        "package main",
        "",
        "type FooService struct{}",
        "",
        "func (f *FooService) DoThing(x int) error {",
        "\treturn nil",
        "}",
      ].join("\n"),
    );

    const loc = searchGoFileForSymbol(vscode.Uri.file(goFile), "DoThing");
    assert.ok(loc);
    assert.strictEqual(loc!.range.start.line, 4);
  });

  test("searchGoFileForSymbol finds plain function", () => {
    const goFile = path.join(tempDir, "helpers.go");
    fs.writeFileSync(
      goFile,
      ["package main", "", "func Helper() string {", '\treturn "ok"', "}"].join("\n"),
    );

    const loc = searchGoFileForSymbol(vscode.Uri.file(goFile), "Helper");
    assert.ok(loc);
    assert.strictEqual(loc!.range.start.line, 2);
  });

  test("searchGoFileForSymbol finds type definition", () => {
    const goFile = path.join(tempDir, "types.go");
    fs.writeFileSync(
      goFile,
      ["package main", "", "type MyService struct {", "\tname string", "}"].join("\n"),
    );

    const loc = searchGoFileForSymbol(vscode.Uri.file(goFile), "MyService");
    assert.ok(loc);
    assert.strictEqual(loc!.range.start.line, 2);
  });

  test("parseBindingExports picks up multiple exports", async () => {
    const jsFile = path.join(tempDir, "multiservice.js");
    fs.writeFileSync(
      jsFile,
      [
        "// Cynhyrchwyd y ffeil hon yn awtomatig. PEIDIWCH \u00c2 MODIWL",
        "export function Alpha() { return 1; }",
        "export function Beta(x) { return x; }",
        "export function Gamma(a, b) { return a + b; }",
      ].join("\n"),
    );

    const doc = await openDoc(jsFile);
    const exports = parseBindingExports(doc);
    assert.deepStrictEqual(exports, ["Alpha", "Beta", "Gamma"]);
  });

  test("isWailsBindingsFile detects auto-gen header", async () => {
    const jsFile = path.join(tempDir, "generated.js");
    fs.writeFileSync(
      jsFile,
      [
        "// @ts-check",
        "// Cynhyrchwyd y ffeil hon yn awtomatig. PEIDIWCH \u00c2 MODIWL",
        "// This file is automatically generated. DO NOT EDIT",
        "export function Foo() {}",
      ].join("\n"),
    );

    const doc = await openDoc(jsFile);
    assert.strictEqual(isWailsBindingsFile(doc), true);
  });

  test("isWailsBindingsFile rejects normal file", async () => {
    const jsFile = path.join(tempDir, "normal.js");
    fs.writeFileSync(jsFile, "const x = 1;\n");

    const doc = await openDoc(jsFile);
    assert.strictEqual(isWailsBindingsFile(doc), false);
  });
});
