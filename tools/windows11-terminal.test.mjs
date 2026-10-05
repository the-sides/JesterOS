import { test, expect } from 'bun:test';
import { createCommands as createTerminalCommands, createState as createTerminalState } from '../frontend/src/windows11-terminal.js';
import { createFileCommands } from '../frontend/src/windows11-explorer.js';

function scene() {
  const apps = {
    nextFileId: 1,
    files: [{ id: 'root', parentId: null, name: 'C:', kind: 'folder', content: '', deleted: false, revision: 1 }],
    terminal: createTerminalState(),
  };
  const context = { invoke: async (name, target, payload) => commands[name](target, payload) };
  const commands = { ...createFileCommands(apps), ...createTerminalCommands(apps, context) };
  const target = { tabId: 'terminal-1' };
  return {
    apps,
    async run(input) {
      commands['win11.terminal.input'](target, { input });
      return commands['win11.terminal.run'](target, {});
    },
  };
}

test('unquoted chaining and pipes reject before any virtual filesystem mutation', async () => {
  const { apps, run } = scene();
  for (const input of [
    'echo first && echo second',
    'echo first;echo second',
    'echo first|echo second',
    'echo changed > output.txt;echo second',
    'echo changed > output.txt && echo second',
    'touch first.txt|touch second.txt',
  ]) {
    const before = structuredClone(apps.files);
    const result = await run(input);
    expect(result).toMatchObject({ status: 'applied', supported: false, succeeded: false });
    expect(apps.files).toEqual(before);
    expect(apps.nextFileId).toBe(1);
  }
});

test('quoted operators are literal text, including redirection characters', async () => {
  const { apps, run } = scene();
  expect(await run('echo ">"')).toMatchObject({ succeeded: true });
  expect(apps.terminal.tabs[0].lines.at(-1)).toBe('>');
  expect(await run('echo "a|b;c&d>e"')).toMatchObject({ succeeded: true });
  expect(apps.terminal.tabs[0].lines.at(-1)).toBe('a|b;c&d>e');
  expect(await run('echo ">" > "Literal.txt"')).toMatchObject({ succeeded: true });
  expect(apps.files.find(file => file.name === 'Literal.txt')?.content).toBe('>');
  expect(await run('cat "Literal.txt"')).toMatchObject({ succeeded: true });
  expect(apps.terminal.tabs[0].lines.at(-1)).toBe('>');
});
