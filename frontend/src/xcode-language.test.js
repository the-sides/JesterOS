import test from 'node:test';
import assert from 'node:assert/strict';
import { compileXcodeSources, createXcodeRuntime, stepXcodeRuntime, runXcodeRuntime, XCODE_LANGUAGE_HELP, XCODE_SOURCE_TEMPLATES } from './xcode-language.js';

const source = (text, language = 'swift', id = 'main') => ({ id, path: language === 'swift' ? `${id}.swift` : `${id}.m`, language, text, revision: 3, fileId: `file-${id}`, fileRevision: 7 });
function build(text, language = 'swift', options = {}) {
  const result = compileXcodeSources([source(text, language)], options);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.ok(result.program); return result.program;
}
function execute(text, language = 'swift', options = {}) {
  const program = build(text, language, options);
  return runXcodeRuntime(program, createXcodeRuntime(program), { maxSteps: 20000 });
}

test('editing real source changes computed variables, branch choice, and output', () => {
  const text = 'var count: Int = 2\ncount = count * 3 + 1\nif count > 6 {\n print("large", count)\n} else {\n print("small", count)\n}\n';
  const original = execute(text), edited = execute(text.replace('= 2', '= 1'));
  assert.equal(original.status, 'finished'); assert.equal(original.variables.count, 7);
  assert.deepEqual(original.console, ['large 7']); assert.deepEqual(edited.console, ['small 4']);
});

test('integer and floating expressions use actual precedence and division semantics', () => {
  const runtime = execute('let whole = 7 / 2\nlet fraction: Double = 7.0 / 2.0\nprint(whole, fraction, 2 + 3 * 4, -5 % 2, !(2 > 3))\n');
  assert.equal(runtime.status, 'finished'); assert.deepEqual(runtime.console, ['3 3.5 14 -1 true']);
  assert.equal(runtime.variables.whole, 3); assert.equal(runtime.variables.fraction, 3.5);
});

test('Objective-C Foundation/main/autoreleasepool declarations and NSLog are evaluated', () => {
  const runtime = execute('#import <Foundation/Foundation.h>\nint main(int argc, const char * argv[]) {\n @autoreleasepool {\n  NSString * greeting = @"Hello";\n  int count = 2;\n  count++;\n  BOOL ready = count == 3;\n  if (ready) { NSLog(@"%@ %d %%", greeting, count); } else { NSLog(@"wrong"); }\n }\n return 0;\n}\n', 'objc');
  assert.equal(runtime.status, 'finished'); assert.equal(runtime.exitCode, 0); assert.deepEqual(runtime.console, ['Hello 3 %']);
});

test('Swift range and while loops evaluate bounds and lexical scopes', () => {
  const runtime = execute('var total = 0\nfor i in 1...3 {\n let twice = i * 2\n total += twice\n}\nwhile total < 15 {\n total += 1\n}\nprint(total)\n');
  assert.equal(runtime.status, 'finished'); assert.deepEqual(runtime.console, ['15']);
  assert.deepEqual(runtime.variables, { total: 15 });
  const nested = execute('var total = 0\nfor i in 0..<2 {\n for j in 0..<3 {\n total += i + j\n }\n}\nprint(total)\n');
  assert.deepEqual(nested.console, ['9']); assert.equal(nested.status, 'finished');
});

test('Objective-C C for initializer, condition, and increment execute repeatedly', () => {
  const runtime = execute('int main() {\n int total = 0;\n for (int i = 0; i < 4; i++) {\n  int doubled = i * 2;\n  total += doubled;\n }\n NSLog(@"total=%d", total);\n return 0;\n}\n', 'objc');
  assert.equal(runtime.status, 'finished'); assert.deepEqual(runtime.console, ['total=12']); assert.equal(runtime.variables.total, 12);
  assert.equal(Object.hasOwn(runtime.variables, 'i'), false);
});

test('syntax diagnostics identify the actual File, line and column without a program', () => {
  const result = compileXcodeSources([source('let count = 1\nprint(\n')]);
  assert.equal(result.ok, false); assert.equal(result.program, null); assert.equal(result.diagnostics.length, 1);
  assert.deepEqual(Object.keys(result.diagnostics[0]).sort(), ['column', 'fileId', 'line', 'message', 'severity']);
  assert.equal(result.diagnostics[0].fileId, 'file-main'); assert.equal(result.diagnostics[0].line, 3); assert.equal(result.diagnostics[0].column, 1);
  assert.equal(result.diagnostics[0].severity, 'error');
  const objc = compileXcodeSources([source('int count = 2\nNSLog(@"bad");', 'objc')]);
  assert.equal(objc.ok, false); assert.match(objc.diagnostics[0].message, /semicolon/);
});

test('unsupported framework syntax, arbitrary calls, message sends and interpolation never report success', () => {
  for (const [text, language] of [
    ['import SwiftUI\nstruct View: View { }', 'swift'],
    ['let n = 1\nprint("value \\(n)")', 'swift'],
    ['system("touch forbidden")', 'swift'],
    ['eval("1 + 1")', 'swift'],
    ['[NSFileManager defaultManager];', 'objc'],
    ['#define VALUE 3\nNSLog(@"x");', 'objc'],
    ['func greet() { print("x") }', 'swift'],
  ]) {
    const result = compileXcodeSources([source(text, language)]);
    assert.equal(result.ok, false, text); assert.equal(result.program, null, text); assert.ok(result.diagnostics[0].message);
  }
  assert.equal(compileXcodeSources([source('let a = 1\na = 2\n')]).ok, false);
  assert.equal(compileXcodeSources([source('print(missing)\n')]).ok, false);
  assert.equal(compileXcodeSources([source('print(String(1, 2))\n')]).ok, false);
});

test('breakpoints pause before execution and continuation skips exactly the paused statement once', () => {
  const program = build('var count = 0\nwhile count < 3 {\n count += 1\n print(count)\n}\n');
  const breakpoints = [{ sourceId: 'main', line: 3, enabled: true }], initial = createXcodeRuntime(program);
  const initialSnapshot = JSON.stringify(initial);
  let runtime = runXcodeRuntime(program, initial, { breakpoints });
  assert.equal(JSON.stringify(initial), initialSnapshot); assert.equal(runtime.status, 'paused'); assert.equal(runtime.pauseReason, 'breakpoint');
  assert.equal(runtime.current.line, 3); assert.equal(runtime.variables.count, 0); assert.deepEqual(runtime.console, []);
  runtime = runXcodeRuntime(program, runtime, { breakpoints });
  assert.equal(runtime.pauseReason, 'breakpoint'); assert.equal(runtime.variables.count, 1); assert.deepEqual(runtime.console, ['1']);
  runtime = stepXcodeRuntime(program, runtime);
  assert.equal(runtime.pauseReason, 'step'); assert.equal(runtime.variables.count, 2); assert.equal(runtime.current.line, 4);
  runtime = runXcodeRuntime(program, runtime, { breakpoints: [] });
  assert.equal(runtime.status, 'finished'); assert.deepEqual(runtime.console, ['1', '2', '3']);
});

test('disabled and other-source breakpoints do not pause execution', () => {
  const program = build('let value = 4\nprint(value)\n');
  const runtime = runXcodeRuntime(program, createXcodeRuntime(program), { breakpoints: [{ sourceId: 'main', line: 1, enabled: false }, { sourceId: 'other', line: 2, enabled: true }] });
  assert.equal(runtime.status, 'finished'); assert.deepEqual(runtime.console, ['4']);
});

test('single step follows taken branches and preserves the old runtime snapshot', () => {
  const program = build('var n = 1\nif n == 1 {\n n += 2\n} else {\n n = 0\n}\nprint(n)\n');
  const ready = createXcodeRuntime(program), first = stepXcodeRuntime(program, ready);
  assert.deepEqual(ready.variables, {}); assert.equal(first.variables.n, 1); assert.equal(first.current.line, 2);
  const second = stepXcodeRuntime(program, first); assert.equal(second.current.line, 3); assert.equal(second.variables.n, 1);
  const third = stepXcodeRuntime(program, second); assert.equal(third.variables.n, 3); assert.equal(third.current.line, 7);
  assert.equal(first.variables.n, 1); assert.deepEqual(stepXcodeRuntime(program, third).console, ['3']);
});

test('continuing after a step executes the currently paused breakpoint statement', () => {
  const program = build('let n = 4\nprint(n)\n');
  const paused = stepXcodeRuntime(program, createXcodeRuntime(program));
  assert.equal(paused.current.line, 2);
  const runtime = runXcodeRuntime(program, paused, { breakpoints: [{ sourceId: 'main', line: 2, enabled: true }] });
  assert.equal(runtime.status, 'finished'); assert.deepEqual(runtime.console, ['4']);
});

test('source-defined preview content, color and control state are dynamic', () => {
  const text = 'var count = 2\ncount += 1\nPreview("Counter", "Count: " + String(count), "#aabbcc")\nText("Rows: " + String(count * 2))\nButton("Continue", count > 2)\n';
  const runtime = execute(text), edited = execute(text.replace('= 2', '= 0'));
  assert.deepEqual(runtime.preview, { title: 'Counter', text: 'Count: 3', background: '#aabbcc', controls: [{ id: 'control-1', kind: 'label', text: 'Rows: 6', enabled: false }, { id: 'control-2', kind: 'button', text: 'Continue', enabled: true }] });
  assert.equal(edited.preview.text, 'Count: 1'); assert.equal(edited.preview.controls[1].enabled, false);
  const objc = execute('int main() { int n = 2; Preview(@"Counter", String(n), @"#112233"); Button(@"Go", YES); return 0; }', 'objc');
  assert.equal(objc.preview.text, '2'); assert.equal(objc.preview.controls[0].enabled, true);
});

test('runtime failures retain source-linked truthful errors and never append fabricated output', () => {
  for (const [text, message] of [
    ['print("before")\nlet broken = 4 / 0\nprint("after")\n', /Division by zero/],
    ['let n: Int = "wrong"\n', /integer/],
    ['Text("missing preview")\n', /Call Preview/],
    ['Preview("title", "text", "red")\n', /hexadecimal/],
    ['while 1 { print("bad") }\n', /boolean/],
  ]) {
    const runtime = execute(text);
    assert.equal(runtime.status, 'error'); assert.match(runtime.diagnostics[0].message, message); assert.equal(runtime.diagnostics[0].fileId, 'file-main'); assert.equal(runtime.diagnostics[0].sourceId, 'main');
    assert.ok(runtime.diagnostics[0].line >= 1); assert.ok(runtime.diagnostics[0].column >= 1); assert.ok(!runtime.console.includes('after'));
  }
  const log = execute('NSLog(@"%d", @"wrong");', 'objc');
  assert.equal(log.status, 'error'); assert.match(log.diagnostics[0].message, /integer/);
});

test('short circuit expressions do not evaluate skipped failing operands', () => {
  const runtime = execute('print(false && (1 / 0 == 0), true || (1 / 0 == 0))\n');
  assert.equal(runtime.status, 'finished'); assert.deepEqual(runtime.console, ['false true']);
});

test('infinite loops stop at a finite cumulative quota; slice budget can resume', () => {
  const program = build('var n = 0\nwhile true {\n n += 1\n}\n', 'swift', { maxSteps: 35 });
  let runtime = runXcodeRuntime(program, createXcodeRuntime(program), { maxSteps: 2 });
  assert.equal(runtime.status, 'paused'); assert.equal(runtime.pauseReason, 'budget'); assert.equal(runtime.variables.n, 0);
  runtime = runXcodeRuntime(program, runtime, { maxSteps: 20000 });
  assert.equal(runtime.status, 'error'); assert.match(runtime.diagnostics[0].message, /step quota/); assert.equal(runtime.steps, 35); assert.ok(runtime.variables.n > 0);
  assert.deepEqual(runXcodeRuntime(program, runtime), runtime);
});

test('output, source, expression-depth and preview-control quotas are enforced', () => {
  const runtime = execute('print("four")\nprint("four")\n', 'swift', { maxOutputUnits: 7 });
  assert.equal(runtime.status, 'error'); assert.deepEqual(runtime.console, ['four']); assert.match(runtime.diagnostics[0].message, /output quota/);
  const tooLarge = compileXcodeSources([source(' '.repeat(XCODE_LANGUAGE_HELP.limits.maxSourceUnits + 1))]);
  assert.equal(tooLarge.ok, false); assert.match(tooLarge.diagnostics[0].message, /Source text quota/);
  const tooDeep = compileXcodeSources([source(`print(${'('.repeat(60)}1${')'.repeat(60)})`)]);
  assert.equal(tooDeep.ok, false); assert.match(tooDeep.diagnostics[0].message, /nesting quota/);
  const tooLong = compileXcodeSources([source(`print(${Array(70).fill('1').join(' + ')})`)]);
  assert.equal(tooLong.ok, false); assert.match(tooLong.diagnostics[0].message, /nesting quota/);
  const controls = execute('Preview("many", "controls")\nfor i in 0..<129 {\n Button(String(i))\n}\n');
  assert.equal(controls.status, 'error'); assert.equal(controls.preview.controls.length, 128); assert.match(controls.diagnostics[0].message, /control quota/);
});

test('multiple source identities and saved program/runtime graphs survive JSON serialization', () => {
  const compiled = compileXcodeSources([source('let shared = 5\n', 'swift', 'model'), source('print(shared * 2)\n', 'swift', 'main')]);
  assert.equal(compiled.ok, true); const program = JSON.parse(JSON.stringify(compiled.program));
  assert.deepEqual(program.sources[0], { id: 'model', path: 'model.swift', language: 'swift', revision: 3, fileId: 'file-model', fileRevision: 7 });
  const ready = createXcodeRuntime(program), first = stepXcodeRuntime(program, ready);
  assert.equal(first.current.sourceId, 'main');
  const restored = JSON.parse(JSON.stringify(first)), final = runXcodeRuntime(program, restored);
  assert.deepEqual(final.console, ['10']); assert.deepEqual(JSON.parse(JSON.stringify(final)), final);
  const duplicate = compileXcodeSources([source('print(1)'), source('print(2)')]); assert.equal(duplicate.ok, false);
});

test('all four advertised templates are executable source with genuine output or preview', () => {
  assert.deepEqual(Object.keys(XCODE_SOURCE_TEMPLATES).sort(), ['objc-app', 'objc-command-line', 'swift-app', 'swift-command-line']);
  for (const [key, text] of Object.entries(XCODE_SOURCE_TEMPLATES)) {
    const runtime = execute(text, key.startsWith('objc') ? 'objc' : 'swift');
    assert.equal(runtime.status, 'finished', key);
    if (key.endsWith('-app')) { assert.equal(runtime.preview.text, 'Count: 3'); assert.equal(runtime.preview.controls.length, 2); }
    else assert.deepEqual(runtime.console, ['Hello from Xcode']);
  }
});

test('unsaved and archive source diagnostics navigate each distinct canonical source', () => {
  const rows = [
    { ...source('let broken =\n', 'swift', 'unsaved-editor'), fileId: null },
    { ...source('print(missing)\n', 'swift', 'archive-entry'), fileId: null },
  ];
  const result = compileXcodeSources(rows);
  assert.equal(result.ok, false); assert.equal(result.program, null);
  assert.deepEqual(result.diagnostics.map(row => row.fileId), ['unsaved-editor', 'archive-entry']);
  for (const diagnostic of result.diagnostics) {
    assert.ok(rows.find(row => row.id === diagnostic.fileId));
    assert.deepEqual(Object.keys(diagnostic).sort(), ['column', 'fileId', 'line', 'message', 'severity']);
  }
  const invalid = compileXcodeSources([{ ...rows[0], language: 'unsupported' }]);
  assert.equal(invalid.diagnostics[0].fileId, 'unsaved-editor');
  const compiled = compileXcodeSources([{ ...source('print(1 / 0)\n'), fileId: null }]);
  assert.equal(compiled.ok, true); const program = compiled.program;
  const runtime = runXcodeRuntime(program, createXcodeRuntime(program));
  assert.equal(runtime.diagnostics[0].fileId, 'main'); assert.equal(runtime.diagnostics[0].sourceId, 'main');
});
