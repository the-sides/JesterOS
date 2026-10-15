import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, unzipSync } from 'fflate';
import { encodeXcodeProject, decodeXcodeProject, xcodeFixtures, XCODE_PROJECT_MIME, XCODE_CODEC_LIMITS } from './xcode-codec.js';

const encoder = new TextEncoder(), decoder = new TextDecoder();
const project = { name: 'Hello', organization: 'Example & Friends', bundleIdentifier: 'org.example.Hello', platform: 'macos', template: 'command-line', language: 'swift', deploymentTarget: '10.13' };
const source = { id: 'source-1', path: 'Sources/main.swift', language: 'swift', text: 'let greeting = "Hello 🌍"\nprint(greeting)\n', revision: 3, fileId: 'native-file', fileRevision: 7 };
const bytes = value => Uint8Array.from(atob(value.slice(value.indexOf(',') + 1)), char => char.charCodeAt(0));
const packageFiles = () => unzipSync(bytes(encodeXcodeProject(project, [source]).content));
const repack = files => zipSync(files, { level: 6, mtime: new Date('2000-01-01T00:00:00Z') });
function editProject(edit, files = packageFiles()) {
  files['Hello.xcodeproj/project.pbxproj'] = encoder.encode(edit(decoder.decode(files['Hello.xcodeproj/project.pbxproj'])));
  return repack(files);
}
function centralOffset(container) {
  const view = new DataView(container.buffer, container.byteOffset, container.byteLength);
  for (let at = container.length - 22; at >= 0; at--) if (view.getUint32(at, true) === 0x06054b50) return view.getUint32(at + 16, true);
  throw new Error('Authored ZIP has no central directory');
}

test('export is a genuine native Xcode ZIP with OpenStep objects, scheme, workspace and exact native source bytes', () => {
  const encoded = encodeXcodeProject(project, [source]);
  assert.equal(encoded.name, 'Hello.xcodeproj.zip');
  assert.equal(encoded.mime, XCODE_PROJECT_MIME);
  assert.deepEqual([...bytes(encoded.content).slice(0, 4)], [80, 75, 3, 4]);
  const files = unzipSync(bytes(encoded.content));
  assert.deepEqual(files['Sources/main.swift'], encoder.encode(source.text));
  const pbx = decoder.decode(files['Hello.xcodeproj/project.pbxproj']);
  assert.match(pbx, /^\/\/ !\$\*UTF8\*\$!/u);
  for (const isa of ['PBXProject', 'PBXNativeTarget', 'PBXGroup', 'PBXFileReference', 'PBXBuildFile', 'PBXSourcesBuildPhase', 'PBXFrameworksBuildPhase', 'PBXResourcesBuildPhase', 'XCBuildConfiguration', 'XCConfigurationList']) assert.match(pbx, new RegExp(`isa = ${isa};`, 'u'));
  assert.match(pbx, /SWIFT_VERSION = 4\.0;/u);
  assert.throws(() => JSON.parse(pbx));
  assert.match(decoder.decode(files['Hello.xcodeproj/xcshareddata/xcschemes/Hello.xcscheme']), /<Scheme[\s\S]*<BuildableReference[\s\S]*<LaunchAction/u);
  assert.match(decoder.decode(files['Hello.xcodeproj/project.xcworkspace/contents.xcworkspacedata']), /<Workspace version="1\.0"><FileRef location="self:"\/>/u);
  assert.equal(Object.keys(files).some(path => path.endsWith('.json')), false);
});

test('roundtrip retains project metadata and exact UTF-8 source, reconstructing source identity from native file references', () => {
  const encoded = encodeXcodeProject(project, [source]);
  const decoded = decodeXcodeProject(encoded.content);
  assert.deepEqual(decoded.project, project);
  assert.equal(decoded.sources.length, 1);
  assert.equal(decoded.sources[0].text, source.text);
  assert.equal(decoded.sources[0].path, source.path);
  assert.equal(decoded.sources[0].language, 'swift');
  assert.match(decoded.sources[0].id, /^[A-F0-9]{24}$/u);
  assert.equal(decoded.sources[0].fileId, null);
  assert.equal(decoded.sources[0].fileRevision, 0);
  assert.equal(decoded.sources[0].revision, 0);
  assert.deepEqual(decodeXcodeProject(encodeXcodeProject(decoded.project, decoded.sources).content), decoded);
  assert.deepEqual(decodeXcodeProject(bytes(encoded.content)), decoded);
});

for (const platform of ['ios', 'macos']) for (const language of ['swift', 'objc']) test(`${platform} ${language} app exports native Info.plist and matching deployment settings`, () => {
  const p = { ...project, platform, template: 'app', language, deploymentTarget: platform === 'ios' ? '17.0' : '14.0' };
  const s = { ...source, language, path: language === 'swift' ? 'App.swift' : 'main.m', text: language === 'swift' ? 'print("App")\n' : '#import <Foundation/Foundation.h>\nint main() { NSLog(@"App"); return 0; }\n' };
  const exported = encodeXcodeProject(p, [s]), files = unzipSync(bytes(exported.content));
  assert.match(decoder.decode(files['Hello/Info.plist']), /<plist version="1\.0"><dict><key>CFBundleExecutable<\/key>/u);
  assert.deepEqual(decodeXcodeProject(exported.content).project, p);
  assert.equal(decodeXcodeProject(exported.content).sources[0].text, s.text);
});

test('source references use real source files rather than unreferenced decoys or hidden manifests', () => {
  const files = packageFiles();
  files['unreferenced.swift'] = encoder.encode('print("decoy")\n');
  files['metadata.json'] = encoder.encode('{"sources":["fake"]}');
  files[source.path] = encoder.encode('print("edited native bytes")\n');
  const result = decodeXcodeProject(repack(files));
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].text, 'print("edited native bytes")\n');
  delete files[source.path];
  assert.throws(() => decodeXcodeProject(repack(files)), /Referenced source file missing/u);
});

test('imports actual group-relative native references and projects inside an enclosing folder', () => {
  const container = editProject(pbx => pbx
    .replace('path = "Sources/main.swift"; sourceTree = SOURCE_ROOT;', 'path = "main.swift"; sourceTree = "<group>";')
    .replace('children = (000000000000000000000064, 000000000000000000000004); sourceTree = "<group>";', 'children = (000000000000000000000064, 000000000000000000000004); path = Sources; sourceTree = "<group>";'));
  const wrapped = Object.fromEntries(Object.entries(unzipSync(container)).map(([path, data]) => ['Downloaded/' + path, data]));
  const imported = decodeXcodeProject(repack(wrapped));
  assert.equal(imported.sources[0].path, source.path);
  assert.equal(imported.sources[0].text, source.text);
});

test('OpenStep parser handles native comments, quoted values, trailing commas and Unicode escapes', () => {
  const container = editProject(pbx => pbx
    .replace('ORGANIZATIONNAME = "Example & Friends";', 'ORGANIZATIONNAME /* organization */ = "Example & \\U0046riends";')
    .replace('knownRegions = (en, Base);', 'knownRegions = (en, /* region */ Base,);'));
  assert.deepEqual(decodeXcodeProject(container).project, project);
});

test('unsupported source language, SDK, target type, shell build phase and multiple targets fail rather than pretending to import', () => {
  for (const [edit, message] of [
    [pbx => pbx.replace('sourcecode.swift', 'sourcecode.cpp.cpp'), /file type/u],
    [pbx => pbx.replaceAll('SDKROOT = macosx;', 'SDKROOT = watchos;'), /SDKROOT/u],
    [pbx => pbx.replace('com.apple.product-type.tool', 'com.apple.product-type.framework'), /product type/u],
    [pbx => pbx.replace('isa = PBXFrameworksBuildPhase;', 'isa = PBXShellScriptBuildPhase;'), /Unsupported build phase/u],
    [pbx => pbx.replace('targets = (000000000000000000000002);', 'targets = (000000000000000000000002, 000000000000000000000002);'), /single-target/u],
    [pbx => pbx.replace('dependencies = ();', 'dependencies = (000000000000000000000002);'), /dependencies/u],
  ]) assert.throws(() => decodeXcodeProject(editProject(edit)), message);
  assert.throws(() => decodeXcodeProject('{"project":{},"sources":[]}'), /genuine Xcode project ZIP/u);
  assert.throws(() => decodeXcodeProject(repack({ 'Hello.xcodeproj/project.pbxproj': encoder.encode('{"name":"not OpenStep"}') }))), /pbxproj/u);
});

test('malformed, cyclic and duplicated OpenStep objects are rejected', () => {
  for (const edit of [
    pbx => pbx.replace('archiveVersion = 1;', 'archiveVersion = 1; archiveVersion = 1;'),
    pbx => pbx.replace('classes = {};', 'classes = { __proto__ = {}; };'),
    pbx => pbx.replace('productName = "Hello";', 'productName = "Hello;'),
    pbx => pbx.replace('children = (000000000000000000000064, 000000000000000000000004);', 'children = (000000000000000000000003);'),
    pbx => pbx + '\nmaliciousTrailingToken',
  ]) assert.throws(() => decodeXcodeProject(editProject(edit)));
});

test('traversal, absolute paths, Windows paths and external source references are never loaded', () => {
  for (const path of ['../outside.swift', '/etc/main.swift', 'C:/main.swift', 'Sources/../../main.swift', 'Sources\\main.swift']) {
    const files = packageFiles(); files[path] = encoder.encode('print("outside")');
    assert.throws(() => decodeXcodeProject(repack(files)), error => error.code === 'unsafe_path');
    assert.throws(() => encodeXcodeProject(project, [{ ...source, path }]), error => error.code === 'unsafe_path');
  }
  assert.throws(() => decodeXcodeProject(editProject(pbx => pbx.replace('path = "Sources/main.swift"; sourceTree = SOURCE_ROOT;', 'path = "../outside.swift"; sourceTree = SOURCE_ROOT;'))), error => error.code === 'unsafe_path');
  assert.throws(() => decodeXcodeProject(editProject(pbx => pbx.replace('path = "Sources/main.swift"; sourceTree = SOURCE_ROOT;', 'path = "/tmp/main.swift"; sourceTree = "<absolute>";'))), error => error.code === 'unsafe_path');
});

test('corrupt payload, header mismatch, truncated ZIP and symlink metadata fail safely', () => {
  const stored = zipSync(packageFiles(), { level: 0 });
  const corrupt = stored.slice();
  const view = new DataView(corrupt.buffer), payload = 30 + view.getUint16(26, true) + view.getUint16(28, true);
  corrupt[payload] ^= 1;
  assert.throws(() => decodeXcodeProject(corrupt), /checksum/u);
  assert.throws(() => decodeXcodeProject(stored.subarray(0, stored.length - 10)), /central directory/u);
  const mismatch = stored.slice(); mismatch[8] = 8;
  assert.throws(() => decodeXcodeProject(mismatch), /header mismatch/u);
  const symlink = stored.slice();
  new DataView(symlink.buffer).setUint32(centralOffset(symlink) + 38, 0xa1ff0000, true);
  assert.throws(() => decodeXcodeProject(symlink), error => error.code === 'unsafe_path');
  const encrypted = stored.slice();
  new DataView(encrypted.buffer).setUint16(centralOffset(encrypted) + 8, 1, true);
  assert.throws(() => decodeXcodeProject(encrypted), /Encrypted/u);
});

test('ZIP entry count, declared expansion, actual expansion and per-source bounds are enforced', () => {
  const files = packageFiles();
  for (let i = 0; i < XCODE_CODEC_LIMITS.entries; i++) files[`extras/${i}.txt`] = new Uint8Array();
  assert.throws(() => decodeXcodeProject(repack(files)), error => error.code === 'limit_exceeded');
  const large = repack(packageFiles());
  new DataView(large.buffer).setUint32(centralOffset(large) + 24, XCODE_CODEC_LIMITS.expandedBytes + 1, true);
  assert.throws(() => decodeXcodeProject(large), error => error.code === 'limit_exceeded');
  const oversizedSources = packageFiles(); oversizedSources[source.path] = encoder.encode('a'.repeat(XCODE_CODEC_LIMITS.sourceBytes + 1));
  assert.throws(() => decodeXcodeProject(repack(oversizedSources)), error => error.code === 'limit_exceeded');
  assert.throws(() => encodeXcodeProject(project, [{ ...source, text: 'a'.repeat(XCODE_CODEC_LIMITS.sourceBytes + 1) }]), error => error.code === 'limit_exceeded');
  const lying = repack(packageFiles()), start = centralOffset(lying), view = new DataView(lying.buffer);
  const local = view.getUint32(start + 42, true);
  view.setUint32(start + 24, 1, true); view.setUint32(local + 22, 1, true);
  assert.throws(() => decodeXcodeProject(lying), error => error.code === 'limit_exceeded');
});

test('encoder rejects colliding paths, malformed Unicode, invalid metadata and unsupported iOS command-line targets', () => {
  assert.throws(() => encodeXcodeProject(project, [source, source]), /Duplicate source path/u);
  assert.throws(() => encodeXcodeProject(project, [{ ...source, text: '\ud800' }]), /Unicode/u);
  assert.throws(() => encodeXcodeProject({ ...project, name: '../Escape' }, [source]), error => error.code === 'unsafe_path');
  assert.throws(() => encodeXcodeProject({ ...project, platform: 'ios' }, [source]), /iOS command-line/u);
  assert.throws(() => encodeXcodeProject({ ...project, bundleIdentifier: '$(UNKNOWN)' }, [source]), /bundle identifier/u);
  assert.throws(() => encodeXcodeProject(project, [{ ...source, path: 'Hello.xcodeproj/project.swift' }]), /conflicts/u);
  assert.throws(() => encodeXcodeProject(project, [{ ...source, path: 'file.swift' }, { ...source, path: 'file.swift/main.swift' }]), /collision/u);
});

test('Root seeds contain genuine Swift, Objective-C and packaged project content with stable seed IDs', () => {
  assert.deepEqual(xcodeFixtures.map(row => row.id), ['xcode-sample-swift', 'xcode-sample-objc', 'xcode-sample-project']);
  assert.equal(xcodeFixtures[0].mime, 'text/x-swift');
  assert.match(xcodeFixtures[0].content, /print\(greeting\)/u);
  assert.equal(xcodeFixtures[1].mime, 'text/x-objective-c');
  assert.match(xcodeFixtures[1].content, /NSLog\(@"Hello from Xcode"\)/u);
  const sample = decodeXcodeProject(xcodeFixtures[2].content);
  assert.equal(sample.project.template, 'command-line');
  assert.equal(sample.sources[0].path, 'main.swift');
  assert.equal(sample.sources[0].text, xcodeFixtures[0].content);
});

test('source BOM and native CRLF bytes survive roundtrip without normalization', () => {
  const native = { ...source, text: '\ufefflet value = 1\r\nprint(value)\r\n' };
  const encoded = encodeXcodeProject(project, [native]);
  assert.equal(decodeXcodeProject(encoded.content).sources[0].text, native.text);
  assert.deepEqual(unzipSync(bytes(encoded.content))[native.path], encoder.encode(native.text));
});
