// Fictional, source-driven local interpreter. This is not a Swift/Clang compiler.
const HARD_LIMITS = Object.freeze({ maxSources: 32, maxSourceUnits: 262144, maxTokens: 40000, maxInstructions: 8192, maxDepth: 48, maxSteps: 20000, maxOutputUnits: 65536, maxStringUnits: 8192, maxConsoleLines: 1024, maxControls: 128, maxVariables: 256 });
export const XCODE_LANGUAGE_HELP = Object.freeze({
  description: 'Bounded local Swift/Objective-C subset; no host compiler, debugger, filesystem, network, classes, arbitrary function calls, or Apple framework execution.',
  swift: 'let/var name[: Int|Double|String|Bool] = expression; assignment, +=/-=/*=//=, print, if/else, while, for name in start..<end or start...end. Foundation import is accepted. Statements end at a newline or semicolon.',
  objc: 'Foundation import, optional int main() / int main(int argc, const char * argv[]) envelope and @autoreleasepool; int/double/float/NSInteger/BOOL/NSString * declarations, assignments, ++/--, NSLog, if/else, while, C for loops, return integer. Statements require semicolons.',
  expressions: 'Numbers, strings (Objective-C @"strings"), booleans, names, parentheses, + - * / %, comparisons, && || !, and String/Int/Double/Bool conversions. No string interpolation or Objective-C message sends.',
  preview: 'Explicit fictional vocabulary: Preview(title, text[, background]); Text(text); Button(text[, enabled]). Arguments are evaluated from source. Buttons are preview-only controls, not host UI actions.',
  limits: HARD_LIMITS,
});
export const XCODE_SOURCE_TEMPLATES = Object.freeze({
  'swift-command-line': 'import Foundation\nlet greeting: String = "Hello from Xcode"\nprint(greeting)\n',
  'swift-app': 'import Foundation\nvar count: Int = 3\nPreview("My App", "Count: " + String(count), "#ffffff")\nText("Welcome")\nButton("Continue", count > 0)\n',
  'objc-command-line': '#import <Foundation/Foundation.h>\nint main() {\n    NSLog(@"Hello from Xcode");\n    return 0;\n}\n',
  'objc-app': '#import <Foundation/Foundation.h>\nint main() {\n    int count = 3;\n    Preview(@"My App", @"Count: " + String(count), @"#ffffff");\n    Text(@"Welcome");\n    Button(@"Continue", count > 0);\n    return 0;\n}\n',
});

class LanguageError extends Error {
  constructor(message, location) { super(message); this.location = location; }
}
const fail = (message, location) => { throw new LanguageError(message, location); };
const boundedInteger = (value, fallback, maximum) => Number.isInteger(value) && value > 0 ? Math.min(value, maximum) : fallback;
const safeName = name => !['__proto__', 'constructor', 'prototype'].includes(name);
const TYPES = { Int: 'int', Double: 'number', Float: 'number', String: 'string', Bool: 'boolean', int: 'int', double: 'number', float: 'number', NSInteger: 'int', BOOL: 'boolean', NSString: 'string' };
const PRECEDENCE = { '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 4, '<=': 4, '>': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 };
const ARITY = { print: [0, 32], NSLog: [1, 32], Preview: [2, 3], Text: [1, 1], Button: [1, 2], String: [1, 1], Int: [1, 1], Double: [1, 1], Bool: [1, 1] };

function tokenize(source) {
  const tokens = []; let offset = 0, line = 1, column = 1;
  const location = () => ({ sourceId: source.id, fileId: source.fileId ?? null, line, column });
  const advance = () => { const c = source.text[offset++]; if (c === '\n') { line++; column = 1; } else column++; return c; };
  const emit = (kind, value, loc) => { if (tokens.length >= HARD_LIMITS.maxTokens) fail('Token quota exceeded.', loc); tokens.push({ kind, value, loc }); };
  while (offset < source.text.length) {
    const c = source.text[offset], loc = location();
    if (c === '\r' || c === ' ' || c === '\t') { advance(); continue; }
    if (c === '\n') { advance(); emit('newline', '\n', loc); continue; }
    if (source.text.startsWith('//', offset)) { while (offset < source.text.length && source.text[offset] !== '\n') advance(); continue; }
    if (source.text.startsWith('/*', offset)) {
      advance(); advance();
      while (offset < source.text.length && !source.text.startsWith('*/', offset)) advance();
      if (offset === source.text.length) fail('Unterminated block comment.', loc);
      advance(); advance(); continue;
    }
    if (c === '#') {
      let directive = ''; while (offset < source.text.length && source.text[offset] !== '\n') directive += advance();
      if (source.language !== 'objc' || !/^#\s*(?:import|include)\s*<Foundation\/Foundation\.h>\s*$/.test(directive)) fail('Unsupported preprocessor directive; only Foundation import is supported.', loc);
      emit('import', 'Foundation', loc); continue;
    }
    if (c === '@' && source.text.startsWith('@autoreleasepool', offset)) {
      for (let n = 0; n < '@autoreleasepool'.length; n++) advance(); emit('id', '@autoreleasepool', loc); continue;
    }
    if (c === '"' || (c === '@' && source.text[offset + 1] === '"')) {
      if (c === '@') { if (source.language !== 'objc') fail('Objective-C strings are not supported in Swift.', loc); advance(); }
      advance(); let value = '', terminated = false;
      while (offset < source.text.length) {
        const next = advance();
        if (next === '"') { terminated = true; break; }
        if (next === '\n') fail('Unterminated string literal.', loc);
        if (next === '\\') {
          const escaped = advance(); const escapes = { n: '\n', r: '\r', t: '\t', '"': '"', '\\': '\\', '0': '\0' };
          if (!(escaped in escapes)) fail('Unsupported string escape or interpolation.', loc);
          value += escapes[escaped];
        } else value += next;
        if (value.length > HARD_LIMITS.maxStringUnits) fail('String literal quota exceeded.', loc);
      }
      if (!terminated) fail('Unterminated string literal.', loc);
      emit('string', value, loc); continue;
    }
    if (/[0-9]/.test(c)) {
      let value = ''; while (offset < source.text.length && /[0-9]/.test(source.text[offset])) value += advance();
      if (source.text[offset] === '.' && /[0-9]/.test(source.text[offset + 1] || '')) { value += advance(); while (offset < source.text.length && /[0-9]/.test(source.text[offset])) value += advance(); }
      const number = Number(value); if (!Number.isFinite(number)) fail('Numeric literal is not finite.', loc);
      emit('number', number, loc); tokens[tokens.length - 1].numericType = value.includes('.') ? 'number' : 'int'; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let name = ''; while (offset < source.text.length && /[A-Za-z0-9_]/.test(source.text[offset])) name += advance();
      if (!safeName(name)) fail('Reserved identifier is not supported.', loc);
      emit('id', name, loc); continue;
    }
    const operator = ['..<', '...', '==', '!=', '<=', '>=', '&&', '||', '+=', '-=', '*=', '/=', '++', '--'].find(value => source.text.startsWith(value, offset));
    if (operator) { for (let n = 0; n < operator.length; n++) advance(); emit('symbol', operator, loc); continue; }
    if ('(){}[];,:+-*/%=<>!'.includes(c)) { advance(); emit('symbol', c, loc); continue; }
    fail(`Unsupported syntax ${JSON.stringify(c)}.`, loc);
  }
  emit('eof', '', location()); return tokens;
}

class Parser {
  constructor(source, instructions, globals, entryPoint) { this.source = source; this.tokens = tokenize(source); this.index = 0; this.instructions = instructions; this.scopes = [globals]; this.depth = 0; this.controlDepth = 0; this.inMain = false; this.entryPoint = entryPoint; }
  token() { return this.tokens[this.index]; }
  is(value) { return this.token().value === value; }
  take(value) { if (!this.is(value)) return false; this.index++; return true; }
  expect(value) { if (!this.take(value)) fail(`Expected ${JSON.stringify(value)}; found ${JSON.stringify(this.token().value)}.`, this.token().loc); }
  identifier() { const t = this.token(); if (t.kind !== 'id') fail('Expected an identifier.', t.loc); this.index++; return t; }
  newlines() { while (this.token().kind === 'newline') this.index++; }
  separators() { while (this.token().kind === 'newline' || this.is(';')) this.index++; }
  emit(op, fields, loc) { if (this.instructions.length >= HARD_LIMITS.maxInstructions) fail('Instruction quota exceeded.', loc); this.instructions.push({ op, ...fields, loc }); return this.instructions.length - 1; }
  lookup(name, loc) { for (let n = this.scopes.length - 1; n >= 0; n--) if (Object.hasOwn(this.scopes[n], name)) return this.scopes[n][name]; fail(`Unknown variable ${name}.`, loc); }
  declare(name, type, mutable, loc) { const scope = this.scopes[this.scopes.length - 1]; if (Object.hasOwn(scope, name)) fail(`Duplicate declaration ${name}.`, loc); scope[name] = { type, mutable }; }
  expression(min = 0, depth = 0) {
    if (depth >= HARD_LIMITS.maxDepth) fail('Expression nesting quota exceeded.', this.token().loc);
    const t = this.token(); this.index++; let left;
    if (t.kind === 'number' || t.kind === 'string') left = { kind: 'literal', value: t.value, type: t.numericType ?? 'string', loc: t.loc };
    else if (['true', 'false', 'YES', 'NO'].includes(t.value)) {
      if (this.source.language === 'swift' && ['YES', 'NO'].includes(t.value)) fail('Use true or false in Swift.', t.loc);
      left = { kind: 'literal', value: ['true', 'YES'].includes(t.value), type: 'boolean', loc: t.loc };
    } else if (['!', '-', '+'].includes(t.value)) {
      const value = this.expression(7, depth + 1); left = { kind: 'unary', operator: t.value, value, type: t.value === '!' ? 'boolean' : value.type, loc: t.loc };
    }
    else if (t.value === '(') { this.newlines(); left = this.expression(0, depth + 1); this.newlines(); this.expect(')'); }
    else if (t.kind === 'id') {
      if (this.is('(')) {
        if (!['String', 'Int', 'Double', 'Bool'].includes(t.value)) fail(`Unsupported expression call ${t.value}.`, t.loc);
        const args = this.arguments(depth + 1); if (args.length !== 1) fail(`Invalid argument count for ${t.value}.`, t.loc);
        left = { kind: 'call', name: t.value, args, type: TYPES[t.value], loc: t.loc };
      } else { const binding = this.lookup(t.value, t.loc); left = { kind: 'variable', name: t.value, type: binding.type, loc: t.loc }; }
    } else fail('Expected a supported expression.', t.loc);
    left.height ??= left.kind === 'unary' ? 1 + left.value.height : left.kind === 'call' ? 1 + Math.max(...left.args.map(arg => arg.height)) : 1;
    if (left.height >= HARD_LIMITS.maxDepth) fail('Expression nesting quota exceeded.', t.loc);
    while (Object.hasOwn(PRECEDENCE, this.token().value) && PRECEDENCE[this.token().value] >= min) {
      const operator = this.token(); this.index++;
      const right = this.expression(PRECEDENCE[operator.value] + 1, depth + 1);
      const type = PRECEDENCE[operator.value] < 5 ? 'boolean' : left.type === 'string' && right.type === 'string' ? 'string' : left.type === 'int' && right.type === 'int' ? 'int' : 'number';
      const height = 1 + Math.max(left.height, right.height);
      if (height >= HARD_LIMITS.maxDepth) fail('Expression nesting quota exceeded.', operator.loc);
      left = { kind: 'binary', operator: operator.value, left, right, type, height, loc: operator.loc };
    }
    return left;
  }
  arguments(depth = 0) {
    this.expect('('); this.newlines(); const args = [];
    if (!this.is(')')) do { this.newlines(); args.push(this.expression(0, depth + 1)); this.newlines(); if (args.length > 32) fail('Argument quota exceeded.', this.token().loc); } while (this.take(','));
    this.expect(')'); return args;
  }
  end() {
    if (this.take(';')) return;
    if (this.source.language === 'objc') fail('Expected semicolon.', this.token().loc);
    if (this.token().kind !== 'newline' && this.token().kind !== 'eof' && !this.is('}')) fail('Expected a newline or semicolon; unsupported trailing syntax.', this.token().loc);
  }
  block() {
    this.newlines(); this.expect('{'); const loc = this.tokens[this.index - 1].loc;
    if (++this.depth > HARD_LIMITS.maxDepth) fail('Block nesting quota exceeded.', loc);
    this.scopes.push({}); this.emit('enter', {}, loc); this.separators();
    while (!this.is('}')) { if (this.token().kind === 'eof') fail('Unterminated block.', loc); this.statement(); this.separators(); }
    this.expect('}'); this.emit('leave', {}, loc); this.scopes.pop(); this.depth--;
  }
  declaration(withEnd = true) {
    const t = this.identifier(); let type = null, mutable = true, name;
    if (this.source.language === 'swift') {
      if (!['let', 'var'].includes(t.value)) fail('Unsupported Swift declaration.', t.loc);
      mutable = t.value === 'var'; name = this.identifier();
      if (this.take(':')) { const declared = this.identifier(); type = TYPES[declared.value]; if (!['Int', 'Double', 'Float', 'String', 'Bool'].includes(declared.value)) fail('Unsupported Swift type.', declared.loc); }
    } else {
      type = TYPES[t.value]; if (!['int', 'double', 'float', 'NSInteger', 'BOOL', 'NSString'].includes(t.value)) fail('Unsupported Objective-C type.', t.loc);
      if (t.value === 'NSString') this.expect('*'); name = this.identifier();
    }
    this.expect('='); const value = this.expression(); type ??= value.type; this.declare(name.value, type, mutable, name.loc);
    this.emit('declare', { name: name.value, type, mutable, value }, t.loc); if (withEnd) this.end();
  }
  assignment(withEnd = true) {
    const name = this.identifier(), binding = this.lookup(name.value, name.loc);
    if (!binding.mutable) fail(`Cannot assign to constant ${name.value}.`, name.loc);
    const operator = this.token(); this.index++; let value;
    if (['++', '--'].includes(operator.value)) { if (this.source.language !== 'objc') fail('Increment syntax is only supported in Objective-C.', operator.loc); value = { kind: 'literal', value: 1, type: 'int', loc: operator.loc }; }
    else { if (!['=', '+=', '-=', '*=', '/='].includes(operator.value)) fail('Unsupported assignment syntax.', operator.loc); value = this.expression(); }
    this.emit('assign', { name: name.value, operator: operator.value, value }, name.loc); if (withEnd) this.end();
  }
  statement() {
    const t = this.token(), language = this.source.language;
    if (t.kind === 'import') { this.index++; return; }
    if (this.take('import')) { if (language !== 'swift') fail('Use #import in Objective-C.', t.loc); const module = this.identifier(); if (module.value !== 'Foundation') fail('Only Foundation import is supported.', module.loc); this.end(); return; }
    if (this.take('if')) {
      if (++this.controlDepth > HARD_LIMITS.maxDepth) fail('Conditional nesting quota exceeded.', t.loc);
      const condition = this.expression(); const branch = this.emit('branch', { condition, target: 0 }, t.loc); this.block();
      this.newlines();
      if (this.take('else')) { const jump = this.emit('jump', { target: 0 }, t.loc); this.instructions[branch].target = this.instructions.length; this.newlines(); if (this.is('if')) this.statement(); else this.block(); this.instructions[jump].target = this.instructions.length; }
      else this.instructions[branch].target = this.instructions.length;
      this.controlDepth--; return;
    }
    if (this.take('while')) { const head = this.instructions.length, condition = this.expression(); const branch = this.emit('branch', { condition, target: 0 }, t.loc); this.block(); this.emit('jump', { target: head }, t.loc); this.instructions[branch].target = this.instructions.length; return; }
    if (this.take('for')) {
      this.scopes.push({}); this.emit('enter', {}, t.loc);
      if (language === 'swift') {
        const name = this.identifier(); this.expect('in'); const start = this.expression(), range = this.token();
        if (!['..<', '...'].includes(range.value)) fail('Expected a bounded Swift range.', range.loc);
        this.index++; const end = this.expression(); this.declare(name.value, 'int', false, name.loc);
        const head = this.emit('range', { name: name.value, start, end, inclusive: range.value === '...', target: 0 }, t.loc);
        this.block(); this.emit('jump', { target: head }, t.loc); this.instructions[head].target = this.instructions.length;
      } else {
        this.expect('('); this.newlines();
        if (Object.hasOwn(TYPES, this.token().value)) this.declaration(false); else this.assignment(false);
        this.expect(';'); this.newlines(); const head = this.instructions.length, condition = this.expression(); this.expect(';'); this.newlines();
        const branch = this.emit('branch', { condition, target: 0 }, t.loc), beforeUpdate = this.instructions.length;
        this.assignment(false); const update = this.instructions.splice(beforeUpdate); this.newlines(); this.expect(')'); this.block();
        for (const row of update) this.emit('update', { assignment: row }, row.loc);
        this.emit('jump', { target: head }, t.loc); this.instructions[branch].target = this.instructions.length;
      }
      this.emit('leave', {}, t.loc); this.scopes.pop(); return;
    }
    if (this.take('@autoreleasepool')) { if (language !== 'objc') fail('Unsupported Swift syntax.', t.loc); this.block(); return; }
    if (language === 'objc' && t.value === 'int' && this.tokens[this.index + 1]?.value === 'main' && this.tokens[this.index + 2]?.value === '(') {
      if (this.inMain || this.depth || this.entryPoint.sourceId !== null) fail('Only one top-level main function is supported.', t.loc);
      this.entryPoint.sourceId = this.source.id;
      this.index += 3;
      if (!this.is(')')) { for (const value of ['int', 'argc', ',', 'const', 'char', '*', 'argv']) this.expect(value); this.expect('['); this.expect(']'); }
      this.expect(')'); this.inMain = true; this.block(); this.inMain = false; return;
    }
    if (this.take('return')) { if (language !== 'objc' || !this.inMain) fail('Return is supported only inside Objective-C main.', t.loc); const value = this.expression(); this.emit('return', { value }, t.loc); this.end(); return; }
    if ((language === 'swift' && ['let', 'var'].includes(t.value)) || (language === 'objc' && Object.hasOwn(TYPES, t.value))) { this.declaration(); return; }
    if (t.kind === 'id' && this.tokens[this.index + 1]?.value === '(') {
      this.index++;
      if (!['print', 'NSLog', 'Preview', 'Text', 'Button'].includes(t.value) || (t.value === 'print' && language !== 'swift') || (t.value === 'NSLog' && language !== 'objc')) fail(`Unsupported statement call ${t.value}.`, t.loc);
      const args = this.arguments(); const [min, max] = ARITY[t.value]; if (args.length < min || args.length > max) fail(`Invalid argument count for ${t.value}.`, t.loc);
      this.emit('call', { name: t.value, args }, t.loc); this.end(); return;
    }
    if (t.kind === 'id' && ['=', '+=', '-=', '*=', '/=', '++', '--'].includes(this.tokens[this.index + 1]?.value)) { this.assignment(); return; }
    fail(`Unsupported statement ${JSON.stringify(t.value)}.`, t.loc);
  }
  parse() { this.separators(); while (this.token().kind !== 'eof') { this.statement(); this.separators(); } }
}

export function compileXcodeSources(sources, options = {}) {
  const instructions = [], diagnostics = [], metadata = [], globals = {}, ids = new Set(), entryPoint = { sourceId: null }; let units = 0;
  const diagnostic = (message, loc = {}) => ({ fileId: loc.fileId ?? loc.sourceId ?? '', line: loc.line ?? 1, column: loc.column ?? 1, severity: 'error', message });
  if (!Array.isArray(sources) || !sources.length || sources.length > HARD_LIMITS.maxSources) return { ok: false, diagnostics: [diagnostic('Expected 1–32 source files.')], program: null };
  for (const source of sources) {
    const loc = { sourceId: typeof source?.id === 'string' ? source.id : null, fileId: source?.fileId ?? null, line: 1, column: 1 };
    if (!source || typeof source.id !== 'string' || !source.id || ids.has(source.id) || typeof source.path !== 'string' || typeof source.text !== 'string' || !['swift', 'objc'].includes(source.language)) { diagnostics.push(diagnostic('Invalid or duplicate source record.', loc)); continue; }
    ids.add(source.id); units += source.text.length;
    if (units > HARD_LIMITS.maxSourceUnits) { diagnostics.push(diagnostic('Source text quota exceeded.', loc)); break; }
    metadata.push({ id: source.id, path: source.path, language: source.language, revision: source.revision ?? 0, fileId: source.fileId ?? null, fileRevision: source.fileRevision ?? 0 });
    try { new Parser(source, instructions, globals, entryPoint).parse(); }
    catch (error) { if (!(error instanceof LanguageError)) throw error; diagnostics.push(diagnostic(error.message, error.location)); }
  }
  if (diagnostics.length) return { ok: false, diagnostics, program: null };
  return { ok: true, diagnostics: [], program: { version: 1, instructions, sources: metadata, limits: { maxSteps: boundedInteger(options.maxSteps, HARD_LIMITS.maxSteps, HARD_LIMITS.maxSteps), maxOutputUnits: boundedInteger(options.maxOutputUnits, HARD_LIMITS.maxOutputUnits, HARD_LIMITS.maxOutputUnits) } } };
}

const structural = row => ['enter', 'leave', 'jump', 'update'].includes(row.op);
const currentAt = (program, pc) => { const loc = program.instructions[pc]?.loc; return loc ? { sourceId: loc.sourceId, line: loc.line, column: loc.column } : null; };
function findBinding(runtime, name, loc) { for (let i = runtime.scopes.length - 1; i >= 0; i--) if (Object.hasOwn(runtime.scopes[i], name)) return runtime.scopes[i][name]; fail(`Unknown variable ${name}.`, loc); }
function projectVariables(runtime) { runtime.variables = {}; for (const scope of runtime.scopes) for (const [name, binding] of Object.entries(scope)) runtime.variables[name] = binding.value; }
function numeric(value, loc) { if (typeof value !== 'number' || !Number.isFinite(value)) fail('Expected a finite number.', loc); return value; }
function boolean(value, loc) { if (typeof value !== 'boolean') fail('Expected a boolean condition.', loc); return value; }
function checkedValue(value, loc) { if (typeof value === 'number' && !Number.isFinite(value)) fail('Arithmetic result is not finite.', loc); if (typeof value === 'string' && value.length > HARD_LIMITS.maxStringUnits) fail('String value quota exceeded.', loc); return value; }
function typeOf(value) { return typeof value === 'number' ? (Number.isInteger(value) ? 'int' : 'number') : typeof value; }
function typed(value, type, loc) {
  if (type === 'int' && (!Number.isSafeInteger(value) || typeof value !== 'number')) fail('Expected a safe integer value.', loc);
  if (type === 'number') numeric(value, loc);
  if (['string', 'boolean'].includes(type) && typeof value !== type) fail(`Expected a ${type} value.`, loc);
  return checkedValue(value, loc);
}
function binary(operator, left, right, loc, integer = false) {
  if (operator === '+') { if (typeof left === 'string' && typeof right === 'string') { if (left.length + right.length > HARD_LIMITS.maxStringUnits) fail('String value quota exceeded.', loc); return left + right; } return typed(numeric(left, loc) + numeric(right, loc), integer ? 'int' : 'number', loc); }
  if (['-', '*', '/', '%'].includes(operator)) {
    numeric(left, loc); numeric(right, loc); if (['/', '%'].includes(operator) && right === 0) fail('Division by zero.', loc);
    const result = operator === '-' ? left - right : operator === '*' ? left * right : operator === '/' ? left / right : left % right;
    return typed(integer && operator === '/' ? Math.trunc(result) : result, integer ? 'int' : 'number', loc);
  }
  if (['==', '!='].includes(operator)) { if (typeof left !== typeof right) fail('Comparison operands must have matching types.', loc); return operator === '==' ? left === right : left !== right; }
  if (['<', '<=', '>', '>='].includes(operator)) { if (typeof left !== typeof right || !['number', 'string'].includes(typeof left)) fail('Ordered comparison requires two numbers or two strings.', loc); return operator === '<' ? left < right : operator === '<=' ? left <= right : operator === '>' ? left > right : left >= right; }
  fail('Unsupported binary operator.', loc);
}
function evaluate(expression, runtime, depth = 0) {
  if (depth >= HARD_LIMITS.maxDepth) fail('Expression evaluation quota exceeded.', expression.loc);
  const e = expression;
  if (e.kind === 'literal') return typed(e.value, e.type ?? typeOf(e.value), e.loc);
  if (e.kind === 'variable') return findBinding(runtime, e.name, e.loc).value;
  if (e.kind === 'unary') { const v = evaluate(e.value, runtime, depth + 1); return e.operator === '!' ? !boolean(v, e.loc) : e.operator === '-' ? -numeric(v, e.loc) : numeric(v, e.loc); }
  if (e.kind === 'binary') {
    const left = evaluate(e.left, runtime, depth + 1);
    if (e.operator === '&&') return boolean(left, e.loc) && boolean(evaluate(e.right, runtime, depth + 1), e.loc);
    if (e.operator === '||') return boolean(left, e.loc) || boolean(evaluate(e.right, runtime, depth + 1), e.loc);
    return binary(e.operator, left, evaluate(e.right, runtime, depth + 1), e.loc, e.type === 'int');
  }
  if (e.kind === 'call') {
    if (e.args.length !== 1) fail(`Invalid argument count for ${e.name}.`, e.loc);
    const value = evaluate(e.args[0], runtime, depth + 1);
    if (e.name === 'String') return checkedValue(String(value), e.loc);
    if (e.name === 'Bool') { if (typeof value === 'boolean') return value; if (value === 'true' || value === 'false') return value === 'true'; fail('Bool conversion requires a boolean or true/false string.', e.loc); }
    if (typeof value !== 'number' && (typeof value !== 'string' || !/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value))) fail('Numeric conversion requires a numeric value or decimal string.', e.loc);
    const number = Number(value); numeric(number, e.loc); return e.name === 'Int' ? typed(Math.trunc(number), 'int', e.loc) : number;
  }
  fail('Invalid expression graph.', e.loc);
}
function assign(row, runtime) {
  const binding = findBinding(runtime, row.name, row.loc); if (!binding.mutable) fail(`Cannot assign to constant ${row.name}.`, row.loc);
  const value = evaluate(row.value, runtime), operator = row.operator;
  binding.value = typed(operator === '=' ? value : binary(operator === '++' ? '+' : operator === '--' ? '-' : operator[0], binding.value, value, row.loc, binding.type === 'int' && row.value.type === 'int'), binding.type, row.loc);
}
function formatLog(args, loc) {
  if (typeof args[0] !== 'string') fail('NSLog requires a format string.', loc);
  let text = '', index = 1;
  for (let i = 0; i < args[0].length; i++) {
    const c = args[0][i]; if (c !== '%') { text += c; continue; }
    const code = args[0][++i];
    if (code === '%') { text += '%'; continue; }
    if (!['@', 'd', 'i', 'f'].includes(code)) fail('Unsupported NSLog format specifier.', loc);
    if (index >= args.length) fail('NSLog format argument is missing.', loc);
    const value = args[index++];
    if (['d', 'i'].includes(code)) typed(value, 'int', loc); if (code === 'f') numeric(value, loc);
    const part = String(value); if (text.length + part.length > HARD_LIMITS.maxStringUnits) fail('Formatted output quota exceeded.', loc); text += part;
  }
  if (index !== args.length) fail('NSLog has unused format arguments.', loc);
  return checkedValue(text, loc);
}
function executeCall(row, runtime, program) {
  const args = row.args.map(expression => evaluate(expression, runtime));
  if (row.name === 'print' || row.name === 'NSLog') {
    const text = row.name === 'NSLog' ? formatLog(args, row.loc) : args.map(String).join(' ');
    if (runtime.console.length >= HARD_LIMITS.maxConsoleLines || runtime.outputUnits + text.length + 1 > program.limits.maxOutputUnits) fail('Console output quota exceeded.', row.loc);
    runtime.console.push(text); runtime.outputUnits += text.length + 1; return;
  }
  for (let i = 0; i < (row.name === 'Preview' ? Math.min(args.length, 3) : 1); i++) typed(args[i], 'string', row.loc);
  if (row.name === 'Preview') {
    const background = args[2] ?? '#ffffff'; if (!/^#[0-9a-fA-F]{6}$/.test(background)) fail('Preview background must be a six-digit hexadecimal color.', row.loc);
    runtime.preview = { title: args[0], text: args[1], background, controls: [] }; return;
  }
  if (!runtime.preview) fail('Call Preview before adding preview controls.', row.loc);
  if (runtime.preview.controls.length >= HARD_LIMITS.maxControls) fail('Preview control quota exceeded.', row.loc);
  const enabled = row.name === 'Button' ? (args[1] ?? true) : false; boolean(enabled, row.loc);
  runtime.preview.controls.push({ id: `control-${runtime.preview.controls.length + 1}`, kind: row.name === 'Text' ? 'label' : 'button', text: args[0], enabled });
}
function runtimeError(runtime, error) {
  const loc = error.location ?? {};
  runtime.status = 'error'; runtime.pauseReason = null; runtime.skipBreakpointPc = null;
  runtime.diagnostics.push({ fileId: loc.fileId ?? loc.sourceId ?? '', sourceId: loc.sourceId ?? null, line: loc.line ?? 1, column: loc.column ?? 1, severity: 'error', message: error.message });
}
function countStep(program, runtime, loc) { if (runtime.steps >= program.limits.maxSteps) fail('Execution step quota exceeded.', loc); runtime.steps++; }
function normalize(program, runtime) {
  while (runtime.pc < program.instructions.length && structural(program.instructions[runtime.pc])) {
    const row = program.instructions[runtime.pc]; countStep(program, runtime, row.loc);
    if (row.op === 'enter') runtime.scopes.push({});
    if (row.op === 'leave') { if (runtime.scopes.length <= 1) fail('Invalid scope graph.', row.loc); runtime.scopes.pop(); }
    if (row.op === 'update') assign(row.assignment, runtime);
    runtime.pc = row.op === 'jump' ? row.target : runtime.pc + 1;
  }
  projectVariables(runtime); runtime.current = currentAt(program, runtime.pc);
  if (runtime.pc >= program.instructions.length && runtime.status !== 'error') { runtime.status = 'finished'; runtime.pauseReason = null; runtime.current = null; }
}
export function createXcodeRuntime(program) {
  const runtime = { pc: 0, status: 'ready', variables: {}, console: [], preview: null, current: null, steps: 0, diagnostics: [], scopes: [{}], loopState: {}, pauseReason: null, skipBreakpointPc: null, outputUnits: 0, exitCode: null };
  try { normalize(program, runtime); } catch (error) { if (!(error instanceof LanguageError)) throw error; runtimeError(runtime, error); }
  return runtime;
}
function copyRuntime(runtime) {
  return { ...runtime, variables: { ...runtime.variables }, console: [...runtime.console], diagnostics: runtime.diagnostics.map(row => ({ ...row })), scopes: runtime.scopes.map(scope => Object.fromEntries(Object.entries(scope).map(([name, binding]) => [name, { ...binding }]))), loopState: Object.fromEntries(Object.entries(runtime.loopState).map(([key, row]) => [key, { ...row }])), preview: runtime.preview ? { ...runtime.preview, controls: runtime.preview.controls.map(row => ({ ...row })) } : null, current: runtime.current ? { ...runtime.current } : null };
}
function advanceRuntime(program, runtime) {
  if (['finished', 'error'].includes(runtime.status)) return;
  try {
    normalize(program, runtime); if (runtime.status === 'finished') return;
    const row = program.instructions[runtime.pc]; countStep(program, runtime, row.loc); runtime.status = 'running'; runtime.pauseReason = null; runtime.skipBreakpointPc = null;
    let next = runtime.pc + 1;
    if (row.op === 'declare') {
      if (runtime.scopes.reduce((sum, scope) => sum + Object.keys(scope).length, 0) >= HARD_LIMITS.maxVariables) fail('Variable quota exceeded.', row.loc);
      const scope = runtime.scopes[runtime.scopes.length - 1]; if (Object.hasOwn(scope, row.name)) fail(`Duplicate declaration ${row.name}.`, row.loc);
      const value = evaluate(row.value, runtime), type = row.type ?? typeOf(value); scope[row.name] = { value: typed(value, type, row.loc), type, mutable: row.mutable };
    } else if (row.op === 'assign') assign(row, runtime);
    else if (row.op === 'call') executeCall(row, runtime, program);
    else if (row.op === 'branch') { if (!boolean(evaluate(row.condition, runtime), row.loc)) next = row.target; }
    else if (row.op === 'range') {
      const key = String(runtime.pc); let state = runtime.loopState[key];
      if (!state) { const start = typed(evaluate(row.start, runtime), 'int', row.loc), end = typed(evaluate(row.end, runtime), 'int', row.loc); if (end < start) fail('Descending Swift ranges are unsupported.', row.loc); state = { next: start, end }; runtime.loopState[key] = state; }
      if (row.inclusive ? state.next > state.end : state.next >= state.end) { delete runtime.loopState[key]; next = row.target; }
      else { runtime.scopes[runtime.scopes.length - 1][row.name] = { value: state.next, type: 'int', mutable: false }; state.next++; }
    } else if (row.op === 'return') { runtime.exitCode = typed(evaluate(row.value, runtime), 'int', row.loc); next = program.instructions.length; }
    else fail('Unsupported instruction graph.', row.loc);
    runtime.pc = next; normalize(program, runtime);
  } catch (error) { if (!(error instanceof LanguageError)) throw error; runtimeError(runtime, error); projectVariables(runtime); runtime.current = currentAt(program, runtime.pc); }
}
export function stepXcodeRuntime(program, runtime) {
  const next = copyRuntime(runtime); advanceRuntime(program, next);
  if (!['finished', 'error'].includes(next.status)) { next.status = 'paused'; next.pauseReason = 'step'; next.skipBreakpointPc = next.pc; }
  return next;
}
export function runXcodeRuntime(program, runtime, options = {}) {
  const next = copyRuntime(runtime), maxSteps = boundedInteger(options.maxSteps, 2000, HARD_LIMITS.maxSteps);
  if (['finished', 'error'].includes(next.status)) return next;
  const breakpoints = Array.isArray(options.breakpoints) ? options.breakpoints.slice(0, HARD_LIMITS.maxInstructions) : [];
  const skip = ['breakpoint', 'step'].includes(next.pauseReason) ? next.skipBreakpointPc : null; let consumedSkip = false, count = 0;
  while (count < maxSteps && !['finished', 'error'].includes(next.status)) {
    const row = program.instructions[next.pc]; if (!row) { next.status = 'finished'; next.current = null; break; }
    if (!(skip === next.pc && !consumedSkip) && breakpoints.some(point => point?.enabled === true && point.sourceId === row.loc.sourceId && point.line === row.loc.line)) {
      next.status = 'paused'; next.pauseReason = 'breakpoint'; next.skipBreakpointPc = next.pc; next.current = currentAt(program, next.pc); return next;
    }
    consumedSkip = true; advanceRuntime(program, next); count++;
  }
  if (!['finished', 'error'].includes(next.status)) { next.status = 'paused'; next.pauseReason = 'budget'; next.skipBreakpointPc = null; }
  return next;
}
