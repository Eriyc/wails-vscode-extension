# Wails3 Definitions Provider

Navigate from auto-generated Wails3 JavaScript/TypeScript bindings straight to your Go source code.

## Features

### Go to Definition

Ctrl+Click (Cmd+Click on Mac) any Wails binding symbol in JS/TS and jump directly to the Go function or method — skipping the auto-generated glue file entirely.

### CodeLens

Inline **"Go to Go"** links appear above every call-site that uses a bindings import and above each `export function` in the generated glue files.

### Hover

Hover over an exported function in a bindings file to see a quick link to the Go definition.

### Auto-Detection

The bindings directory is automatically detected from your project's `Taskfile.yml` (`-d` flag on `wails3 generate bindings`). No configuration needed for standard Wails3 projects.

## Supported Patterns

```js
// Namespace import
import * as GreetService from "../bindings/changeme";
GreetService.Greet(name);

// Named import
import { Greet } from "../bindings/changeme/greetservice";
Greet(name);

// Default import
import GreetService from "../bindings/changeme";
```

Works with JavaScript, TypeScript, JSX, TSX, Vue, and Svelte files.

## Configuration

| Setting              | Default      | Description                                                                                    |
| -------------------- | ------------ | ---------------------------------------------------------------------------------------------- |
| `wails.bindingsPath` | `"bindings"` | Name or relative path of the bindings directory. Auto-detected from Taskfile.yml when not set. |

| Keybinding | Command              |
| ---------- | -------------------- |
| `Ctrl+F12` | Wails: Go to Backend |

## How It Works

1. Registers a DefinitionProvider, CodeLensProvider, and HoverProvider for JS/TS files
2. Detects bindings imports by matching the configured (or auto-detected) bindings directory name in import specifiers
3. On "Go to Definition", resolves the target through VS Code's built-in providers — if it lands in a bindings file, redirects to the matching Go source
4. Searches Go files by matching the bindings filename stem (e.g. `greetservice.js` → `greetservice.go`), then falls back to a workspace-wide symbol search

## Requirements

- Visual Studio Code 1.109.0+
- A [Wails3](https://v3alpha.wails.io/) project with generated TypeScript/JavaScript bindings

## License

The Unlicense— see [LICENSE](LICENSE)
