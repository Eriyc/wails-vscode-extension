# Changelog

All notable changes to the "Wails3 Bindings — Go to Go Source" extension will be documented in this file.

## [0.1.0] - 2026-02-09

### Added

- **DefinitionProvider**: Ctrl+Click any Wails binding symbol in JS/TS to jump directly to the Go source, bypassing auto-generated glue files
- **CodeLensProvider**: Inline "Go to Go" links above call-sites of bindings imports and above `export function` declarations in glue files
- **HoverProvider**: Hover over exported functions in bindings files to see a quick link to the Go definition
- **Taskfile.yml auto-detection**: Bindings directory is automatically detected from the `-d`/`-dir` flag in `wails3 generate bindings` or from `generates:` entries, with no configuration needed for standard projects
- **FileSystemWatcher**: Taskfile changes automatically invalidate the cached bindings directory
- Configurable `wails.bindingsPath` setting with smart defaults
- `Ctrl+F12` keybinding for "Wails: Go to Backend" command
- Language support for JavaScript, TypeScript, JSX, TSX, Vue, and Svelte
- TypeScript example project (`examples/ts/`) demonstrating extension features with a Wails3 app
