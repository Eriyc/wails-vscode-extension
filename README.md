# Wails3 VSCode Extension

A Visual Studio Code extension that enhances the development experience for Wails3 applications by providing intelligent "Go to Definition" functionality for Wails bindings.

## Features

- **Smart Definition Navigation**: When you Ctrl+Click (or Cmd+Click on Mac) on a Wails binding in your JavaScript/TypeScript code, the extension will take you directly to the Go source code instead of the auto-generated JS glue file.
- **Multiple Pattern Support**: Works with various import and usage patterns:
  - ES6 imports: `import { Function } from './bindings/package'`
  - CommonJS requires: `const { Function } = require('./bindings/package')`
  - Direct usage: `bindings.package.Function()`

## Installation

### From Source

1. Clone the repository:
   ```bash
   git clone https://github.com/Eriyc/wails-vscode-extension.git
   cd wails-vscode-extension
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the extension:
   ```bash
   npm run build
   ```

4. Package the extension (optional):
   ```bash
   npm run package
   ```

5. Install in VSCode:
   - Press `F5` to open a new VSCode window with the extension loaded (for development)
   - Or install the `.vsix` file via "Extensions: Install from VSIX..." command

## Usage

1. Open a Wails3 project in VSCode
2. Navigate to any JavaScript or TypeScript file that uses Wails bindings
3. Ctrl+Click (or Cmd+Click) on any function imported from or used via the bindings
4. The extension will automatically find and open the corresponding Go source file

### Example

Given a JavaScript file with:
```javascript
import { GetUsers } from './bindings/userservice';

// Later in code...
const users = await GetUsers();
```

Ctrl+Clicking on `GetUsers` will navigate to the Go source file where the function is defined:
```go
func (s *UserService) GetUsers() []User {
    // Implementation...
}
```

## Configuration

The extension can be configured through VSCode settings:

- **`wails.bindingsPath`**: Path to the Wails3 bindings directory relative to workspace root (default: `"bindings"`)

### Example Configuration

Add to your `.vscode/settings.json`:
```json
{
  "wails.bindingsPath": "frontend/bindings"
}
```

## How It Works

1. The extension registers a `DefinitionProvider` for JavaScript and TypeScript files
2. When you trigger "Go to Definition" on a binding reference, it:
   - Detects the pattern (import, require, or direct usage)
   - Extracts the package and function names
   - Searches common Go project locations for the source file
   - Finds the function definition in the Go file
   - Returns the location to VSCode

## Supported Project Structures

The extension automatically searches for Go files in these common locations:
- `<workspace>/<package>/`
- `<workspace>/internal/<package>/`
- `<workspace>/pkg/<package>/`
- `<workspace>/app/<package>/`
- `<workspace>/services/<package>/`

## Development

### Building

```bash
npm run build
```

### Watching

```bash
npm run watch
```

### Debugging

1. Open the project in VSCode
2. Press `F5` to start debugging
3. A new VSCode window will open with the extension loaded
4. Set breakpoints in the TypeScript source code

## Requirements

- Visual Studio Code 1.85.0 or higher
- A Wails3 project with Go backend

## License

MIT License - see [LICENSE](LICENSE) file for details

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Roadmap

- [ ] Support for more complex binding patterns
- [ ] Cache Go file locations for better performance
- [ ] Support for viewing both JS and Go definitions
- [ ] Hover documentation from Go comments
- [ ] Auto-completion for binding functions

## Issues

If you encounter any issues or have suggestions, please file them in the [issue tracker](https://github.com/Eriyc/wails-vscode-extension/issues).
