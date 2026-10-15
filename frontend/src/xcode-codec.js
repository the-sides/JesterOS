import { zipSync, Inflate } from 'fflate';
import { archiveCRC32, archivePath } from './archive-codec.js';

export const XCODE_PROJECT_MIME = 'application/x-xcode-project';
export const XCODE_CODEC_LIMITS = Object.freeze({ bytes: 720000, expandedBytes: 1048576, entries: 128, sourceBytes: 131072, sources: 64, tokens: 65536, depth: 32 });
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const fail = (message, code = 'invalid_project') => { throw Object.assign(new Error(message), { code }); };
const dict = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const xml = value => String(value).replace(/[&<>"']/gu, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const quote = value => `"${String(value).replace(/[\\"\n\r\t]/gu, c => ({ '\\': '\\\\', '"': '\\"', '\n': '\\n', '\r': '\\r', '\t': '\\t' })[c])}"`;
const uid = number => number.toString(16).toUpperCase().padStart(24, '0');
function text(value, label, max = 128, empty = false) {
  if (typeof value !== 'string' || (!empty && !value) || value.length > max || /[\x00-\x1f\x7f]|\p{Surrogate}/u.test(value)) fail(`Invalid ${label}.`);
  return value;
}
export function validateProject(project) {
  if (!dict(project)) fail('Expected Xcode project metadata.');
  const name = text(project.name, 'project name', 80);
  if (/[\\/:]|^\.{1,2}$/u.test(name)) fail('Unsafe project name.', 'unsafe_path');
  const organization = text(project.organization, 'organization', 128, true);
  const bundleIdentifier = text(project.bundleIdentifier, 'bundle identifier', 180);
  if (!/^[A-Za-z0-9][A-Za-z0-9.-]*$/u.test(bundleIdentifier)) fail('Invalid bundle identifier.');
  if (!['ios', 'macos'].includes(project.platform) || !['app', 'command-line'].includes(project.template) || !['swift', 'objc'].includes(project.language)) fail('Unsupported platform, template or language.', 'unsupported_project');
  if (project.platform === 'ios' && project.template === 'command-line') fail('iOS command-line targets are unsupported.', 'unsupported_project');
  if (typeof project.deploymentTarget !== 'string' || !/^\d{1,2}\.\d{1,2}(?:\.\d{1,2})?$/u.test(project.deploymentTarget)) fail('Invalid deployment target.');
  return { name, organization, bundleIdentifier, platform: project.platform, template: project.template, language: project.language, deploymentTarget: project.deploymentTarget };
}
function sourceRows(sources) {
  if (!Array.isArray(sources) || !sources.length || sources.length > XCODE_CODEC_LIMITS.sources) fail('Project requires 1–64 native source files.', 'limit_exceeded');
  const paths = new Set();
  return sources.map(source => {
    if (!dict(source)) fail('Invalid source row.');
    const path = archivePath(source.path);
    if (paths.has(path)) fail('Duplicate source path.');
    paths.add(path);
    if (!['swift', 'objc'].includes(source.language) || !(source.language === 'swift' ? /\.swift$/u : /\.m$/u).test(path)) fail('Source extension and language must match.', 'unsupported_project');
    if (typeof source.text !== 'string' || /\p{Surrogate}|\x00/u.test(source.text)) fail('Source must contain valid Unicode text.');
    const bytes = encoder.encode(source.text);
    if (bytes.length > XCODE_CODEC_LIMITS.sourceBytes) fail('Source file exceeds 128 KiB.', 'limit_exceeded');
    return { path, language: source.language, bytes };
  });
}
function envelope(bytes) {
  if (bytes.length > XCODE_CODEC_LIMITS.bytes) fail('Xcode ZIP exceeds the Files size limit.', 'limit_exceeded');
  let binary = '';
  for (let at = 0; at < bytes.length; at += 8192) binary += String.fromCharCode(...bytes.subarray(at, at + 8192));
  return `data:${XCODE_PROJECT_MIME};base64,${btoa(binary)}`;
}
const plist = entries => `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>${entries.map(([key, value]) => `<key>${xml(key)}</key><string>${xml(value)}</string>`).join('')}</dict></plist>\n`;
export function encodeXcodeProject(project, sources) {
  const p = validateProject(project), rows = sourceRows(sources), objects = [];
  if (p.language !== (rows.some(row => row.language === 'swift') ? 'swift' : 'objc')) fail('Project language must match its native source languages.', 'unsupported_project');
  const add = (id, fields) => objects.push(`\t\t${id} = { ${fields} };`);
  const app = p.template === 'app', product = p.name + (app ? '.app' : ''), bundle = `${p.name}.xcodeproj`;
  const fileIds = rows.map((_, i) => uid(100 + i)), buildIds = rows.map((_, i) => uid(200 + i));
  rows.forEach((row, i) => {
    add(fileIds[i], `isa = PBXFileReference; lastKnownFileType = ${row.language === 'swift' ? 'sourcecode.swift' : 'sourcecode.c.objc'}; path = ${quote(row.path)}; sourceTree = SOURCE_ROOT;`);
    add(buildIds[i], `isa = PBXBuildFile; fileRef = ${fileIds[i]};`);
  });
  add(uid(1), `isa = PBXProject; attributes = { ORGANIZATIONNAME = ${quote(p.organization)}; }; buildConfigurationList = ${uid(7)}; compatibilityVersion = "Xcode 3.2"; developmentRegion = en; hasScannedForEncodings = 0; knownRegions = (en, Base); mainGroup = ${uid(3)}; productRefGroup = ${uid(4)}; projectDirPath = ""; projectRoot = ""; targets = (${uid(2)});`);
  add(uid(2), `isa = PBXNativeTarget; buildConfigurationList = ${uid(8)}; buildPhases = (${uid(5)}, ${uid(6)}, ${uid(9)}); buildRules = (); dependencies = (); name = ${quote(p.name)}; productName = ${quote(p.name)}; productReference = ${uid(10)}; productType = ${quote(app ? 'com.apple.product-type.application' : 'com.apple.product-type.tool')};`);
  add(uid(3), `isa = PBXGroup; children = (${fileIds.join(', ')}, ${uid(4)}); sourceTree = "<group>";`);
  add(uid(4), `isa = PBXGroup; children = (${uid(10)}); name = Products; sourceTree = "<group>";`);
  add(uid(5), `isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = (${buildIds.join(', ')}); runOnlyForDeploymentPostprocessing = 0;`);
  for (const [id, isa] of [[6, 'PBXFrameworksBuildPhase'], [9, 'PBXResourcesBuildPhase']]) add(uid(id), `isa = ${isa}; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0;`);
  add(uid(10), `isa = PBXFileReference; explicitFileType = ${app ? 'wrapper.application' : 'compiled.mach-o.executable'}; includeInIndex = 0; path = ${quote(product)}; sourceTree = BUILT_PRODUCTS_DIR;`);
  for (const [id, configs] of [[7, [11, 12]], [8, [13, 14]]]) add(uid(id), `isa = XCConfigurationList; buildConfigurations = (${configs.map(uid).join(', ')}); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release;`);
  const deploymentKey = p.platform === 'ios' ? 'IPHONEOS_DEPLOYMENT_TARGET' : 'MACOSX_DEPLOYMENT_TARGET';
  const settings = `SDKROOT = ${p.platform === 'ios' ? 'iphoneos' : 'macosx'}; ${deploymentKey} = ${quote(p.deploymentTarget)}; PRODUCT_BUNDLE_IDENTIFIER = ${quote(p.bundleIdentifier)}; PRODUCT_NAME = ${quote(p.name)}; CLANG_ENABLE_OBJC_ARC = YES;${p.language === 'swift' ? ' SWIFT_VERSION = 4.0;' : ''}${app ? ` INFOPLIST_FILE = ${quote(`${p.name}/Info.plist`)};` : ''}`;
  for (const [id, name, target] of [[11, 'Debug', false], [12, 'Release', false], [13, 'Debug', true], [14, 'Release', true]]) add(uid(id), `isa = XCBuildConfiguration; buildSettings = { ${target ? settings : 'CLANG_ENABLE_MODULES = YES;'}${name === 'Debug' ? ' GCC_OPTIMIZATION_LEVEL = 0; SWIFT_OPTIMIZATION_LEVEL = "-Onone";' : ' SWIFT_OPTIMIZATION_LEVEL = "-O";'} }; name = ${name};`);
  const pbx = `// !$*UTF8*$!\n{\n\tarchiveVersion = 1;\n\tclasses = {};\n\tobjectVersion = 46;\n\tobjects = {\n${objects.join('\n')}\n\t};\n\trootObject = ${uid(1)};\n}\n`;
  const reference = `<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="${uid(2)}" BuildableName="${xml(product)}" BlueprintName="${xml(p.name)}" ReferencedContainer="container:${xml(bundle)}"/>`;
  const scheme = `<?xml version="1.0" encoding="UTF-8"?>\n<Scheme LastUpgradeVersion="1000" version="1.3"><BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES">${reference}</BuildActionEntry></BuildActionEntries></BuildAction><TestAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv="YES"><Testables/></TestAction><LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" debugServiceExtension="internal" allowLocationSimulation="YES"><BuildableProductRunnable runnableDebuggingMode="0">${reference}</BuildableProductRunnable></LaunchAction><ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES" savedToolIdentifier="" useCustomWorkingDirectory="NO" debugDocumentVersioning="YES"><BuildableProductRunnable runnableDebuggingMode="0">${reference}</BuildableProductRunnable></ProfileAction><AnalyzeAction buildConfiguration="Debug"/><ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/></Scheme>\n`;
  const files = Object.create(null);
  files[`${bundle}/project.pbxproj`] = encoder.encode(pbx);
  files[`${bundle}/xcshareddata/xcschemes/${p.name}.xcscheme`] = encoder.encode(scheme);
  files[`${bundle}/project.xcworkspace/contents.xcworkspacedata`] = encoder.encode('<?xml version="1.0" encoding="UTF-8"?>\n<Workspace version="1.0"><FileRef location="self:"/></Workspace>\n');
  if (app) files[`${p.name}/Info.plist`] = encoder.encode(plist([['CFBundleExecutable', '$(EXECUTABLE_NAME)'], ['CFBundleIdentifier', '$(PRODUCT_BUNDLE_IDENTIFIER)'], ['CFBundleName', '$(PRODUCT_NAME)'], ['CFBundlePackageType', 'APPL'], ['CFBundleShortVersionString', '1.0'], ['CFBundleVersion', '1']]));
  for (const row of rows) {
    if (Object.hasOwn(files, row.path) || row.path.startsWith(`${bundle}/`)) fail('Source path conflicts with native project files.', 'unsafe_path');
    files[row.path] = row.bytes;
  }
  for (const path of Object.keys(files)) {
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) if (Object.hasOwn(files, parts.slice(0, i).join('/'))) fail('Source file/directory collision.', 'unsafe_path');
  }
  if (Object.values(files).reduce((sum, bytes) => sum + bytes.length, 0) > XCODE_CODEC_LIMITS.expandedBytes) fail('Expanded project exceeds 1 MiB.', 'limit_exceeded');
  return { name: `${bundle}.zip`, mime: XCODE_PROJECT_MIME, content: envelope(zipSync(files, { level: 6, mtime: new Date('2000-01-01T00:00:00Z') })) };
}

function inputBytes(content) {
  if (content instanceof Uint8Array) {
    if (content.length > XCODE_CODEC_LIMITS.bytes) fail('Project ZIP exceeds input limit.', 'limit_exceeded');
    return content;
  }
  if (typeof content !== 'string' || content.length > Math.ceil(XCODE_CODEC_LIMITS.bytes / 3) * 4 + 128) fail('Expected bounded ZIP data URL.', 'limit_exceeded');
  const match = /^data:(?:application\/x-xcode-project|application\/zip);base64,((?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?)$/u.exec(content);
  if (!match) fail('Expected genuine Xcode project ZIP, not JSON or text.', 'unsupported_project');
  const binary = atob(match[1]);
  if (btoa(binary) !== match[1]) fail('Noncanonical ZIP base64.');
  return inputBytes(Uint8Array.from(binary, c => c.charCodeAt(0)));
}
function readZip(bytes) {
  if (bytes.length < 22) fail('Truncated ZIP.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = at => view.getUint16(at, true), u32 = at => view.getUint32(at, true);
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65557); at--) if (u32(at) === 0x06054b50 && at + 22 + u16(at + 20) === bytes.length) { end = at; break; }
  if (end < 0) fail('Missing ZIP central directory.');
  if (u16(end + 4) || u16(end + 6) || u16(end + 8) !== u16(end + 10)) fail('Multi-disk ZIP unsupported.', 'unsupported_project');
  const count = u16(end + 10), start = u32(end + 16), size = u32(end + 12);
  if (!count || count > XCODE_CODEC_LIMITS.entries) fail('ZIP entry limit exceeded.', 'limit_exceeded');
  if (start + size !== end) fail('Invalid ZIP central directory bounds.');
  let at = start, total = 0;
  const rows = [], names = new Set(), ranges = [];
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || u32(at) !== 0x02014b50) fail('Corrupt ZIP directory entry.');
    const flags = u16(at + 8), method = u16(at + 10), crc = u32(at + 16), compressed = u32(at + 20), length = u32(at + 24), nameLength = u16(at + 28), extraLength = u16(at + 30), commentLength = u16(at + 32), local = u32(at + 42);
    if (flags & ~0x80e || ![0, 8].includes(method) || u16(at + 34)) fail('Encrypted or unsupported ZIP entry.', 'unsupported_project');
    if (at + 46 + nameLength + extraLength + commentLength > end) fail('Truncated ZIP filename.');
    const nameBytes = bytes.subarray(at + 46, at + 46 + nameLength);
    let name;
    try { name = decoder.decode(nameBytes); } catch { fail('ZIP filenames must be UTF-8.', 'unsupported_project'); }
    archivePath(name, name.endsWith('/'));
    const canonicalName = name.replace(/\/$/u, '');
    if (names.has(canonicalName)) fail('Duplicate ZIP path.');
    names.add(canonicalName);
    const mode = u32(at + 38) >>> 16;
    if ((mode & 0xf000) && ![0x8000, 0x4000].includes(mode & 0xf000)) fail('Symlinks and special ZIP entries unsupported.', 'unsafe_path');
    if (name.endsWith('/') && length) fail('ZIP directories must be empty.');
    total += length;
    if (length > XCODE_CODEC_LIMITS.expandedBytes || total > XCODE_CODEC_LIMITS.expandedBytes) fail('Expanded ZIP exceeds 1 MiB.', 'limit_exceeded');
    if (local + 30 > start || u32(local) !== 0x04034b50 || u16(local + 6) !== flags || u16(local + 8) !== method) fail('ZIP local header mismatch.');
    const localNameLength = u16(local + 26), body = local + 30 + localNameLength + u16(local + 28);
    if (body + compressed > start || localNameLength !== nameLength || nameBytes.some((byte, j) => byte !== bytes[local + 30 + j])) fail('ZIP local filename or payload bounds mismatch.');
    if (!(flags & 8) && (u32(local + 14) !== crc || u32(local + 18) !== compressed || u32(local + 22) !== length)) fail('ZIP local sizes or checksum mismatch.');
    let rangeEnd = body + compressed;
    if (flags & 8) {
      const descriptor = rangeEnd + (rangeEnd + 4 <= start && u32(rangeEnd) === 0x08074b50 ? 4 : 0);
      if (descriptor + 12 > start || u32(descriptor) !== crc || u32(descriptor + 4) !== compressed || u32(descriptor + 8) !== length) fail('ZIP data descriptor mismatch.');
      rangeEnd = descriptor + 12;
    }
    ranges.push([local, rangeEnd]);
    rows.push({ name, method, crc, length, body: bytes.subarray(body, body + compressed) });
    at += 46 + nameLength + extraLength + commentLength;
  }
  if (at !== end) fail('Trailing ZIP central directory records.');
  ranges.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < ranges.length; i++) if (ranges[i][0] < ranges[i - 1][1]) fail('Overlapping ZIP entries.');
  const files = new Map();
  for (const row of rows) {
    let output;
    if (row.method === 0) output = row.body;
    else {
      const chunks = []; let length = 0;
      const inflate = new Inflate(chunk => { length += chunk.length; if (length > row.length) fail('ZIP member exceeds declared size.', 'limit_exceeded'); chunks.push(chunk); });
      try { for (let offset = 0; offset < Math.max(1, row.body.length); offset += 128) inflate.push(row.body.subarray(offset, offset + 128), offset + 128 >= row.body.length); } catch (error) { if (error.code) throw error; fail('Corrupt ZIP deflate stream.'); }
      output = new Uint8Array(length); let offset = 0;
      for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
    }
    if (output.length !== row.length || archiveCRC32(output) !== row.crc) fail('ZIP member checksum or length mismatch.');
    if (!row.name.endsWith('/')) files.set(row.name, output);
  }
  for (const name of files.keys()) {
    const parts = name.split('/');
    for (let i = 1; i < parts.length; i++) if (files.has(parts.slice(0, i).join('/'))) fail('ZIP file/directory collision.', 'unsafe_path');
  }
  return files;
}

// OpenStep plist parser: comments, quoted strings, atoms, dictionaries and arrays.
// No eval, host filesystem lookups, macro expansion or shell build phases.
function parseOpenStep(source) {
  let at = 0, tokens = 0;
  function skip() {
    for (;;) {
      while (/\s/u.test(source[at] || '') && at < source.length) at++;
      if (source.startsWith('//', at)) { const end = source.indexOf('\n', at + 2); at = end < 0 ? source.length : end + 1; }
      else if (source.startsWith('/*', at)) { const end = source.indexOf('*/', at + 2); if (end < 0) fail('Unterminated pbxproj comment.'); at = end + 2; }
      else return;
    }
  }
  function string() {
    skip();
    if (++tokens > XCODE_CODEC_LIMITS.tokens) fail('pbxproj token limit exceeded.', 'limit_exceeded');
    if (source[at] === '"') {
      at++; let result = '';
      while (at < source.length) {
        const char = source[at++];
        if (char === '"') return result;
        if (char !== '\\') result += char;
        else {
          const escaped = source[at++];
          const known = { n: '\n', r: '\r', t: '\t', '"': '"', '\\': '\\' };
          if (Object.hasOwn(known, escaped)) result += known[escaped];
          else if (escaped === 'U') { const hex = source.slice(at, at + 4); if (!/^[0-9a-fA-F]{4}$/u.test(hex)) fail('Invalid OpenStep Unicode escape.'); result += String.fromCharCode(parseInt(hex, 16)); at += 4; }
          else fail('Unsupported OpenStep string escape.', 'unsupported_project');
        }
      }
      fail('Unterminated pbxproj string.');
    }
    const match = /^[A-Za-z0-9_.$/<>+\-]+/u.exec(source.slice(at));
    if (!match) fail('Malformed pbxproj atom.');
    at += match[0].length; return match[0];
  }
  function value(depth = 0) {
    if (depth > XCODE_CODEC_LIMITS.depth) fail('pbxproj nesting limit exceeded.', 'limit_exceeded');
    skip();
    if (source[at] === '{') {
      at++; const result = Object.create(null);
      for (;;) {
        skip(); if (source[at] === '}') { at++; return result; }
        const key = string();
        if (['__proto__', 'constructor', 'prototype'].includes(key) || Object.hasOwn(result, key)) fail('Unsafe or duplicate pbxproj key.');
        skip(); if (source[at++] !== '=') fail('Expected pbxproj equals.');
        result[key] = value(depth + 1); skip(); if (source[at++] !== ';') fail('Expected pbxproj semicolon.');
      }
    }
    if (source[at] === '(') {
      at++; const result = [];
      for (;;) {
        skip(); if (source[at] === ')') { at++; return result; }
        result.push(value(depth + 1)); skip();
        if (source[at] === ')') { at++; return result; }
        if (source[at++] !== ',') fail('Expected pbxproj comma.');
      }
    }
    return string();
  }
  const parsed = value(); skip(); if (at !== source.length || !dict(parsed)) fail('Invalid pbxproj root or trailing content.');
  return parsed;
}
function utf8(bytes, label) { try { return decoder.decode(bytes); } catch { fail(`${label} requires UTF-8 text.`, 'unsupported_project'); } }
export function decodeXcodeProject(content) {
  const files = readZip(inputBytes(content));
  const projects = [...files.keys()].filter(path => /(?:^|\/)[^/]+\.xcodeproj\/project\.pbxproj$/u.test(path));
  if (projects.length !== 1) fail('ZIP must contain exactly one real Xcode project.', 'unsupported_project');
  const pbxPath = projects[0], bundle = pbxPath.slice(0, -'/project.pbxproj'.length), parent = bundle.includes('/') ? bundle.slice(0, bundle.lastIndexOf('/') + 1) : '';
  const root = parseOpenStep(utf8(files.get(pbxPath), 'pbxproj'));
  if (root.archiveVersion !== '1' || !dict(root.objects)) fail('Unsupported Xcode project structure.', 'unsupported_project');
  const objects = root.objects;
  const object = (id, isa) => { const row = objects[id]; if (!dict(row) || row.isa !== isa) fail(`Missing or invalid ${isa} reference.`); return row; };
  const project = object(root.rootObject, 'PBXProject');
  if (!Array.isArray(project.targets) || project.targets.length !== 1) fail('Only single-target Xcode projects are supported.', 'unsupported_project');
  const target = object(project.targets[0], 'PBXNativeTarget');
  const template = target.productType === 'com.apple.product-type.application' ? 'app' : target.productType === 'com.apple.product-type.tool' ? 'command-line' : null;
  if (!template) fail('Unsupported native target product type.', 'unsupported_project');
  if (Array.isArray(target.dependencies) && target.dependencies.length || Array.isArray(target.buildRules) && target.buildRules.length || Array.isArray(target.packageProductDependencies) && target.packageProductDependencies.length) fail('Target dependencies, custom build rules and packages are unsupported.', 'unsupported_project');
  if (!Array.isArray(target.buildPhases)) fail('Target build phases missing.');
  const phases = target.buildPhases.map(id => {
    const phase = objects[id];
    if (!dict(phase) || !['PBXSourcesBuildPhase', 'PBXFrameworksBuildPhase', 'PBXResourcesBuildPhase'].includes(phase.isa)) fail('Unsupported build phase (shell scripts are not executed).', 'unsupported_project');
    return phase;
  });
  const sourcePhases = phases.filter(phase => phase.isa === 'PBXSourcesBuildPhase');
  if (sourcePhases.length !== 1 || !Array.isArray(sourcePhases[0].files)) fail('Expected one sources build phase.');
  function settings(id) {
    const list = object(id, 'XCConfigurationList');
    if (!Array.isArray(list.buildConfigurations) || !list.buildConfigurations.length) fail('Build configurations missing.');
    const configurations = list.buildConfigurations.map(ref => object(ref, 'XCBuildConfiguration'));
    const config = configurations.find(row => row.name === list.defaultConfigurationName) || configurations[0];
    if (!dict(config.buildSettings)) fail('Build settings missing.');
    return config.buildSettings;
  }
  const buildSettings = { ...settings(project.buildConfigurationList), ...settings(target.buildConfigurationList) };
  const platform = ({ iphoneos: 'ios', macosx: 'macos' })[buildSettings.SDKROOT];
  if (!platform) fail('Only literal iphoneos or macosx SDKROOT is supported.', 'unsupported_project');
  const parents = new Map(), visited = new Set();
  function group(id, path = '', depth = 0) {
    if (depth > XCODE_CODEC_LIMITS.depth || visited.has(id)) fail('Cyclic, multiply-parented or deeply nested project groups.');
    visited.add(id);
    const row = object(id, 'PBXGroup');
    if (!Array.isArray(row.children)) fail('Group children missing.');
    if (row.sourceTree !== '<group>' && row.sourceTree !== 'SOURCE_ROOT') fail('Unsupported group source tree.', 'unsupported_project');
    const base = row.sourceTree === 'SOURCE_ROOT' ? '' : path;
    const next = row.path ? archivePath(base ? `${base}/${row.path}` : row.path) : base;
    for (const child of row.children) {
      if (parents.has(child)) fail('File belongs to multiple project groups.');
      parents.set(child, next);
      if (objects[child]?.isa === 'PBXGroup') group(child, next, depth + 1);
    }
  }
  group(project.mainGroup);
  const paths = new Set(), refs = new Set();
  const sources = sourcePhases[0].files.map(buildId => {
    const build = object(buildId, 'PBXBuildFile'), ref = object(build.fileRef, 'PBXFileReference');
    if (refs.has(build.fileRef) || !parents.has(build.fileRef)) fail('Duplicate or ungrouped source reference.');
    refs.add(build.fileRef);
    if (!['<group>', 'SOURCE_ROOT'].includes(ref.sourceTree)) fail('External source references are unsupported.', 'unsafe_path');
    const groupPath = ref.sourceTree === 'SOURCE_ROOT' ? '' : parents.get(build.fileRef);
    const path = archivePath(groupPath ? `${groupPath}/${ref.path}` : ref.path);
    if (paths.has(path)) fail('Duplicate referenced source path.');
    paths.add(path);
    const language = /\.swift$/u.test(path) ? 'swift' : /\.m$/u.test(path) ? 'objc' : null;
    if (!language) fail(`Unsupported source file: ${path}.`, 'unsupported_project');
    const fileType = ref.lastKnownFileType || ref.explicitFileType;
    if (fileType && fileType !== (language === 'swift' ? 'sourcecode.swift' : 'sourcecode.c.objc')) fail('Source file type and extension disagree.', 'unsupported_project');
    const bytes = files.get(parent + path);
    if (!bytes) fail(`Referenced source file missing: ${path}.`);
    if (bytes.length > XCODE_CODEC_LIMITS.sourceBytes) fail('Referenced source exceeds 128 KiB.', 'limit_exceeded');
    const sourceText = utf8(bytes, path);
    if (/\x00|\p{Surrogate}/u.test(sourceText)) fail('Invalid native source text.');
    return { id: build.fileRef, path, language, text: sourceText, revision: 0, fileId: null, fileRevision: 0 };
  });
  if (!sources.length || sources.length > XCODE_CODEC_LIMITS.sources) fail('Project requires 1–64 source files.', 'limit_exceeded');
  const metadata = validateProject({ name: target.name, organization: project.attributes?.ORGANIZATIONNAME ?? '', bundleIdentifier: buildSettings.PRODUCT_BUNDLE_IDENTIFIER, platform, template, language: sources.some(source => source.language === 'swift') ? 'swift' : 'objc', deploymentTarget: buildSettings[platform === 'ios' ? 'IPHONEOS_DEPLOYMENT_TARGET' : 'MACOSX_DEPLOYMENT_TARGET'] });
  return { project: metadata, sources };
}

const swiftSample = 'let greeting = "Hello from Xcode"\nprint(greeting)\n';
const objcSample = '#import <Foundation/Foundation.h>\nint main() {\n    NSLog(@"Hello from Xcode");\n    return 0;\n}\n';
export const xcodeFixtures = [
  { id: 'xcode-sample-swift', name: 'Hello.swift', mime: 'text/x-swift', content: swiftSample },
  { id: 'xcode-sample-objc', name: 'Hello.m', mime: 'text/x-objective-c', content: objcSample },
  { id: 'xcode-sample-project', ...encodeXcodeProject({ name: 'Hello', organization: 'JesterOS', bundleIdentifier: 'org.jesteros.Hello', platform: 'macos', template: 'command-line', language: 'swift', deploymentTarget: '10.13' }, [{ path: 'main.swift', language: 'swift', text: swiftSample }]) },
];
