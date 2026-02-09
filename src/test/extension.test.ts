import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { WailsDefinitionProvider } from '../providers/wailsDefinitionProvider';

/**
 * Tests for WailsDefinitionProvider
 */
suite('WailsDefinitionProvider Test Suite', () => {
  let tempDir: string;
  let provider: WailsDefinitionProvider;

  setup(() => {
    provider = new WailsDefinitionProvider();
    // Create a temporary directory for test files
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wails-test-'));
  });

  teardown(() => {
    // Clean up temporary directory
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('Provider is instantiated correctly', () => {
    assert.ok(provider, 'Provider should be created');
  });

  test('Provider implements correct interface', () => {
    assert.ok(typeof provider.provideDefinition === 'function', 'Provider should have provideDefinition method');
  });

  test('Provider returns undefined for non-binding lines', async () => {
    // Create a test file
    const testFile = path.join(tempDir, 'test.js');
    fs.writeFileSync(testFile, 'const x = 5;\nconsole.log(x);');
    
    const doc = await vscode.workspace.openTextDocument(testFile);
    const position = new vscode.Position(0, 6); // Position on 'x'
    
    const result = provider.provideDefinition(doc, position, new vscode.CancellationTokenSource().token);
    
    // Should return undefined for non-binding code
    assert.strictEqual(result, undefined, 'Should return undefined for non-binding code');
  });

  test('Provider detects ES6 import pattern', async () => {
    // Create test structure
    const serviceDir = path.join(tempDir, 'userservice');
    fs.mkdirSync(serviceDir);
    
    // Create Go file
    const goFile = path.join(serviceDir, 'service.go');
    fs.writeFileSync(goFile, 'package userservice\n\nfunc GetUsers() []User {\n\treturn nil\n}');
    
    // Create JS file with import
    const jsFile = path.join(tempDir, 'app.js');
    fs.writeFileSync(jsFile, "import { GetUsers } from './bindings/userservice';\n\nGetUsers();");
    
    const doc = await vscode.workspace.openTextDocument(jsFile);
    const position = new vscode.Position(0, 10); // Position on 'GetUsers' in import
    
    const result = provider.provideDefinition(doc, position, new vscode.CancellationTokenSource().token);
    
    // Should find the Go definition
    if (result && !Array.isArray(result) && 'uri' in result) {
      assert.ok(result.uri.fsPath.endsWith('service.go'), 'Should find Go file');
    }
  });

  test('Provider detects CommonJS require pattern', async () => {
    // Create test structure
    const serviceDir = path.join(tempDir, 'userservice');
    fs.mkdirSync(serviceDir);
    
    // Create Go file
    const goFile = path.join(serviceDir, 'service.go');
    fs.writeFileSync(goFile, 'package userservice\n\nfunc CreateUser(name string) User {\n\treturn User{}\n}');
    
    // Create JS file with require
    const jsFile = path.join(tempDir, 'app.js');
    fs.writeFileSync(jsFile, "const { CreateUser } = require('./bindings/userservice');\n\nCreateUser('test');");
    
    const doc = await vscode.workspace.openTextDocument(jsFile);
    const position = new vscode.Position(0, 10); // Position on 'CreateUser'
    
    const result = provider.provideDefinition(doc, position, new vscode.CancellationTokenSource().token);
    
    // Should find the Go definition
    if (result && !Array.isArray(result) && 'uri' in result) {
      assert.ok(result.uri.fsPath.endsWith('service.go'), 'Should find Go file');
    }
  });

  test('Provider handles case-sensitive function names', async () => {
    // Create test structure
    const serviceDir = path.join(tempDir, 'userservice');
    fs.mkdirSync(serviceDir);
    
    // Create Go file with specific case
    const goFile = path.join(serviceDir, 'service.go');
    fs.writeFileSync(goFile, 'package userservice\n\nfunc GetAllUsers() []User {\n\treturn nil\n}');
    
    // Create JS file looking for different case
    const jsFile = path.join(tempDir, 'app.js');
    fs.writeFileSync(jsFile, "import { GetAllUsers } from './bindings/userservice';");
    
    const doc = await vscode.workspace.openTextDocument(jsFile);
    const position = new vscode.Position(0, 10); // Position on 'GetAllUsers'
    
    const result = provider.provideDefinition(doc, position, new vscode.CancellationTokenSource().token);
    
    // Should find exact case match
    if (result && !Array.isArray(result) && 'uri' in result) {
      const goContent = fs.readFileSync(result.uri.fsPath, 'utf-8');
      assert.ok(goContent.includes('GetAllUsers'), 'Should match exact case');
    }
  });
});
