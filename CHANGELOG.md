# Changelog

All notable changes to the "Wails3 Bindings Definition Provider" extension will be documented in this file.

## [0.1.0] - 2026-02-09

### Added
- Initial release
- Implemented `vscode.DefinitionProvider` for Wails3 bindings
- Support for ES6 import statements (`import { Function } from './bindings/package'`)
- Support for CommonJS require statements (`const { Function } = require('./bindings/package')`)
- Support for direct binding usage (`bindings.package.Function()`)
- Automatic Go source file discovery in common project structures
- Configuration option for custom bindings path
- Comprehensive documentation and README

### Features
- Navigate from JS/TS glue files to Go source definitions
- Works with multiple Go project structures (standard, internal, pkg, app, services)
- Supports function detection in Go files with various patterns
- Language support for JavaScript, TypeScript, JSX, and TSX files
