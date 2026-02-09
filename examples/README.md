# Examples

This directory contains example code to demonstrate how the Wails3 VSCode Extension works.

## Structure

```
examples/
├── go/
│   └── userservice.go      # Example Go backend service
└── js/
    └── usage.js            # Example JavaScript frontend using bindings
```

## How to Use

1. **Open the JavaScript file** (`examples/js/usage.js`)
2. **Find any binding function call** (e.g., `GetAllUsers`, `GetUserByID`, `CreateUser`)
3. **Ctrl+Click (or Cmd+Click on Mac)** on the function name
4. **The extension will navigate you** directly to the Go source file instead of the generated JS glue file

## What Happens

Without this extension:
- Clicking on `GetAllUsers()` would take you to the auto-generated `bindings/userservice.js` file
- You'd see something like: `export function GetAllUsers() { return window.wails.runtime.Call(...) }`
- Not very helpful for understanding the actual implementation!

With this extension:
- Clicking on `GetAllUsers()` takes you directly to `userservice.go`
- You see the actual Go implementation: `func (s *UserService) GetAllUsers() []User { ... }`
- Much more useful for development and debugging!

## Supported Patterns

The extension recognizes these patterns:

### ES6 Imports
```javascript
import { GetAllUsers } from '../bindings/userservice';
```

### CommonJS Requires
```javascript
const { GetAllUsers } = require('../bindings/userservice');
```

### Direct Usage
```javascript
bindings.userservice.GetAllUsers();
```

## Try It Yourself

1. Copy these example files to a Wails3 project
2. Install the extension
3. Try Ctrl+Clicking on any function call
4. Experience the magic! ✨
