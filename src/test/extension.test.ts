import * as assert from 'assert';
import * as vscode from 'vscode';
import { WailsDefinitionProvider } from '../providers/wailsDefinitionProvider';

/**
 * Tests for WailsDefinitionProvider
 */
suite('WailsDefinitionProvider Test Suite', () => {
  vscode.window.showInformationMessage('Start all tests.');

  test('Provider is instantiated correctly', () => {
    const provider = new WailsDefinitionProvider();
    assert.ok(provider, 'Provider should be created');
  });

  test('Provider implements correct interface', () => {
    const provider = new WailsDefinitionProvider();
    assert.ok(typeof provider.provideDefinition === 'function', 'Provider should have provideDefinition method');
  });
});
