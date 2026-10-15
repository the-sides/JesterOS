import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePreferencesProfile, validatePreferencesProfile, buildPreferencesProfileConfiguration, PREFERENCES_PROFILE_FILE_LIMIT } from '../frontend/src/preferences-profile-codec.js';
import { preferencesConfigurationDefaults } from '../frontend/src/preferences-state.js';
import { copyCanonicalData, applyCanonicalData } from '../frontend/src/canonical-data.js';

const escape = value => String(value).replace(/[&<>"']/gu, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]));
const string = value => '<string>' + escape(value) + '</string>';
const entry = (key, value) => '<key>' + escape(key) + '</key>' + value;
const boolean = value => value ? '<true/>' : '<false/>';
const dict = values => '<dict>' + values.join('') + '</dict>';
const uuid = number => '11111111-2222-3333-4444-' + String(number).padStart(12, '0');
function payload(type, values, { id = 'example.payload', number = 2, extra = [] } = {}) {
  return dict([
    entry('PayloadType', string(type)), entry('PayloadIdentifier', string(id)),
    entry('PayloadUUID', string(uuid(number))), entry('PayloadVersion', '<integer>1</integer>'),
    ...Object.entries(values).map(([key, value]) => entry(key, typeof value === 'boolean' ? boolean(value) : string(value))), ...extra,
  ]);
}
function profile(content, { extra = [], id = 'example.profile', declaration = true, doctype = true } = {}) {
  return (declaration ? '<?xml version="1.0" encoding="UTF-8"?>\n' : '') +
    (doctype ? '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n' : '') +
    '<plist version="1.0">' + dict([
      entry('PayloadType', string('Configuration')), entry('PayloadIdentifier', string(id)),
      entry('PayloadUUID', string(uuid(1))), entry('PayloadVersion', '<integer>1</integer>'),
      entry('PayloadDisplayName', string('Local Camera & Firewall')),
      entry('PayloadOrganization', string('Fictional Scene')), entry('PayloadDescription', string('Camera off; incoming connections blocked.')),
      entry('PayloadContent', '<array>' + content + '</array>'), ...extra,
    ]) + '</plist>';
}
const restrictions = values => payload('com.apple.applicationaccess', values, { id: 'example.restrictions', number: 2 });
const firewall = values => payload('com.apple.security.firewall', values, { id: 'example.firewall', number: 3 });
const reject = (source, code) => assert.throws(() => parsePreferencesProfile(source), error => error instanceof Error && (!code || error.code === code));

// XML fixtures intentionally exercise actual .mobileconfig structure and native typed keys,
// rather than renaming JSON or passing pre-decoded invented profile objects.
test('genuine XML Configuration payloads retain native boolean values and inspectable metadata', () => {
  const parsed = parsePreferencesProfile(profile(restrictions({ allowCamera: false, allowMultiplayerGaming: true }) + firewall({ EnableFirewall: true, BlockAllIncoming: true, EnableStealthMode: false })));
  assert.deepEqual(parsed, {
    id: 'example.profile', name: 'Local Camera & Firewall', organization: 'Fictional Scene', description: 'Camera off; incoming connections blocked.',
    settings: [
      { id: 'example.restrictions.allowCamera', controlId: 'parental.allowCamera', value: false },
      { id: 'example.restrictions.allowMultiplayerGaming', controlId: 'parental.allowMultiplayer', value: true },
      { id: 'example.firewall.EnableFirewall', controlId: 'security.firewall', value: true },
      { id: 'example.firewall.BlockAllIncoming', controlId: 'security.blockIncoming', value: true },
      { id: 'example.firewall.EnableStealthMode', controlId: 'security.stealth', value: false },
    ],
  });
  assert.equal(validatePreferencesProfile(parsed).ok, true);
});

test('fixed Apple DTD is recognized without resolving it; optional declarations and XML references work', () => {
  const xml = profile(restrictions({ allowCamera: false }), { declaration: false, doctype: false });
  const source = '\uFEFF<!-- local fixture -->\r\n' + xml.replace('Local Camera &amp; Firewall', 'Camera &#x1F4F7; &#38; &quot;local&quot;');
  assert.equal(parsePreferencesProfile(source).name, 'Camera 📷 & "local"');
  assert.equal(parsePreferencesProfile(profile(restrictions({ allowCamera: true })).replace('http://www.apple.com', 'https://www.apple.com')).settings[0].value, true);
});

test('profile application produces a whole candidate and commits through original canonical collections', () => {
  const configuration = preferencesConfigurationDefaults();
  configuration.locale.languages.push('fr-FR');
  configuration.keyboard.replacements.push({ id: 'replacement', from: 'scene', to: 'authored world' });
  configuration.security.permissions.push({ id: 'camera-access', category: 'camera', appId: 'camera', allowed: true });
  const original = copyCanonicalData(configuration), rows = configuration.profiles.rows, languages = configuration.locale.languages, replacements = configuration.keyboard.replacements;
  const parsed = parsePreferencesProfile(profile(restrictions({ allowCamera: false }) + firewall({ EnableFirewall: true, BlockAllIncoming: true, EnableStealthMode: true })));
  const candidate = buildPreferencesProfileConfiguration(configuration, parsed);
  assert.deepEqual(configuration, original);
  assert.notEqual(candidate, configuration);
  assert.deepEqual(candidate.locale, original.locale);
  assert.deepEqual(candidate.keyboard, original.keyboard);
  assert.deepEqual(candidate.security.permissions, original.security.permissions);
  assert.equal(candidate.parental.allowCamera, false);
  assert.equal(candidate.security.firewall, true);
  assert.equal(candidate.security.blockIncoming, true);
  assert.equal(candidate.security.stealth, true);
  assert.deepEqual(candidate.profiles.rows, [parsed]);
  assert.notEqual(candidate.profiles.rows[0], parsed);
  applyCanonicalData(configuration, candidate);
  assert.equal(configuration.profiles.rows, rows);
  assert.equal(configuration.locale.languages, languages);
  assert.equal(configuration.keyboard.replacements, replacements);
  assert.equal(configuration.parental.allowCamera, false);
  assert.equal(configuration.profiles.rows[0].settings[0].value, false);
});

test('unknown payloads or unmodeled restrictions reject the entire mixed profile instead of stripping contents', () => {
  for (const type of ['com.apple.MCX', 'com.apple.dock', 'com.apple.desktop', 'com.apple.wifi.managed', 'com.apple.security.root', 'example.custom']) {
    reject(profile(restrictions({ allowCamera: false }) + payload(type, { example: true }, { id: 'example.unsupported', number: 9 })), 'unsupported_profile');
  }
  for (const key of ['allowAppStore', 'allowAccountModification', 'allowUIConfigurationProfileInstallation', 'allowGameCenter', 'inventedRestriction']) reject(profile(restrictions({ allowCamera: false, [key]: false })), 'unsupported_profile');
  reject(profile(firewall({ EnableFirewall: true, Applications: '' })), 'unsupported_profile');
  reject(profile(firewall({ EnableFirewall: true, enableStealthMode: true })), 'unsupported_profile');
});

test('native boolean fields and required integer version cannot be coerced from strings or numbers', () => {
  for (const value of ['false', 'true', '0', '1', '']) reject(profile(restrictions({ allowCamera: value })), 'invalid_profile');
  const source = profile(restrictions({ allowCamera: false }));
  reject(source.replace('<false/>', '<integer>0</integer>'), 'invalid_profile');
  reject(source.replace('<integer>1</integer>', '<real>1</real>'), 'invalid_profile');
  reject(source.replace('<integer>1</integer>', '<string>1</string>'), 'invalid_profile');
  reject(source.replace('<integer>1</integer>', '<integer>2</integer>'), 'unsupported_profile');
  reject(profile(firewall({ BlockAllIncoming: true })), 'invalid_profile');
  reject(profile(restrictions({})), 'invalid_profile');
  reject(profile(''), 'invalid_profile');
});

test('duplicate dictionary keys, native identifiers, UUIDs and effective controls are rejected', () => {
  reject(profile(restrictions({ allowCamera: false }), { extra: [entry('PayloadType', string('Configuration'))] }), 'duplicate');
  reject(profile(restrictions({ allowCamera: false }) + payload('com.apple.applicationaccess', { allowMultiplayerGaming: false }, { id: 'example.restrictions', number: 8 })), 'duplicate');
  reject(profile(restrictions({ allowCamera: false }) + payload('com.apple.security.firewall', { EnableFirewall: true }, { id: 'example.other', number: 2 })), 'duplicate');
  reject(profile(restrictions({ allowCamera: false }) + payload('com.apple.applicationaccess', { allowCamera: true }, { id: 'example.other', number: 8 })), 'duplicate');
  reject(profile(payload('com.apple.applicationaccess', { allowCamera: false }, { id: 'example.profile' })), 'duplicate');
});

test('scope, disabled payloads, removal policies and other profile semantics are never silently discarded', () => {
  const source = restrictions({ allowCamera: false });
  assert.equal(parsePreferencesProfile(profile(source, { extra: [entry('PayloadScope', string('System')), entry('PayloadRemovalDisallowed', '<false/>'), entry('PayloadEnabled', '<true/>')] })).settings[0].value, false);
  for (const scope of ['User', 'system', 'Device', '']) reject(profile(source, { extra: [entry('PayloadScope', string(scope))] }), 'unsupported_profile');
  reject(profile(source, { extra: [entry('PayloadEnabled', '<false/>')] }), 'unsupported_profile');
  reject(profile(source, { extra: [entry('PayloadRemovalDisallowed', '<true/>')] }), 'unsupported_profile');
  reject(profile(source, { extra: [entry('ConsentText', dict([entry('default', string('Unmodeled agreement'))]))] }), 'unsupported_profile');
  reject(profile(payload('com.apple.applicationaccess', { allowCamera: false }, { extra: [entry('PayloadScope', string('System'))] })), 'unsupported_profile');
  reject(profile(payload('com.apple.applicationaccess', { allowCamera: false }, { extra: [entry('PayloadEnabled', '<false/>')] })), 'unsupported_profile');
});

test('custom DTDs and entities, binary/CMS/JSON inputs and unsafe keys are explicitly refused', () => {
  const source = profile(restrictions({ allowCamera: false }));
  for (const dtd of [
    '<!DOCTYPE plist SYSTEM "file:///etc/passwd">',
    '<!DOCTYPE plist [<!ENTITY local "expanded">]>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd" [<!ENTITY ext SYSTEM "https://example.invalid/">]>',
  ]) reject(source.replace(/<!DOCTYPE[^>]+>/u, dtd), 'unsupported_profile');
  reject(source.replace('Local Camera &amp; Firewall', '&external;'), 'unsupported_profile');
  reject('bplist00binary', 'unsupported_profile');
  reject('MIISignedCMSBase64', 'unsupported_profile');
  reject(JSON.stringify({ PayloadType: 'Configuration', PayloadContent: [] }), 'unsupported_profile');
  reject(new Uint8Array([98, 112, 108, 105, 115, 116]), 'unsupported_profile');
  for (const key of ['__proto__', 'constructor', 'prototype']) reject(profile(restrictions({ allowCamera: false }), { extra: [entry(key, string('unsafe'))] }), 'invalid_profile');
});

test('malformed dictionary structure, raw XML and invalid Unicode cannot enter retained metadata', () => {
  const source = profile(restrictions({ allowCamera: false }));
  for (const altered of [
    source.replace('<key>PayloadType</key>', '<string>PayloadType</string>'),
    source.replace('<key>PayloadType</key>', '<integer>2</integer>'),
    source.replace('<false/>', '<false>content</false>'),
    source.replace('Local Camera &amp; Firewall', 'unescaped &'),
    source.replace('Local Camera &amp; Firewall', '<script>host effect</script>'),
    source.replace('Local Camera &amp; Firewall', '&#0;'),
    source.replace('Local Camera &amp; Firewall', '&#xD800;'),
    source.replace('Local Camera &amp; Firewall', '&#x110000;'),
    source.replace('Local Camera &amp; Firewall', '\uD800'),
    source.replace('</plist>', ''), source + '<plist version="1.0"></plist>',
    source.replace('<plist version="1.0">', '<plist version="1.0" custom="x">'),
    source.replace('<dict>', '<dict><!-- bad--comment -->'),
  ]) reject(altered);
});

test('profile source, strings, identifiers, arrays, nesting and node growth are bounded', () => {
  const source = profile(restrictions({ allowCamera: false }));
  reject(source + ' '.repeat(PREFERENCES_PROFILE_FILE_LIMIT), 'limit_exceeded');
  reject(source.replace('Local Camera &amp; Firewall', 'x'.repeat(513)), 'limit_exceeded');
  reject(profile(restrictions({ allowCamera: false }), { id: 'x'.repeat(129) }), 'invalid_profile');
  reject(profile(payload('com.apple.applicationaccess', { allowCamera: false }, { id: 'x'.repeat(128) })), 'limit_exceeded');
  reject(profile(restrictions({ allowCamera: false }), { extra: [entry('Unknown', '<array>'.repeat(18) + string('nested') + '</array>'.repeat(18))] }), 'limit_exceeded');
  reject(profile(restrictions({ allowCamera: false }), { extra: [entry('Unknown', '<array>' + '<true/>'.repeat(129) + '</array>')] }), 'limit_exceeded');
  const manyNodes = '<array>' + ('<array>' + '<true/>'.repeat(128) + '</array>').repeat(33) + '</array>';
  reject(profile(restrictions({ allowCamera: false }), { extra: [entry('Unknown', manyNodes)] }), 'limit_exceeded');
});

test('invalid canonical rows, conflicts and missing typed targets cannot partially alter configuration', () => {
  const row = parsePreferencesProfile(profile(restrictions({ allowCamera: false })));
  const configuration = preferencesConfigurationDefaults(), before = copyCanonicalData(configuration);
  for (const altered of [
    { ...row, extra: true }, { ...row, settings: [] },
    { ...row, settings: [{ ...row.settings[0], value: 'false' }] },
    { ...row, settings: [{ ...row.settings[0], value: 0 }] },
    { ...row, settings: [{ ...row.settings[0], controlId: 'dock.autoHide' }] },
    { ...row, settings: [row.settings[0], { ...row.settings[0] }] },
  ]) {
    assert.equal(validatePreferencesProfile(altered).ok, false);
    assert.throws(() => buildPreferencesProfileConfiguration(configuration, altered));
    assert.deepEqual(configuration, before);
  }
  const installed = buildPreferencesProfileConfiguration(configuration, row);
  const installedBefore = copyCanonicalData(installed);
  assert.throws(() => buildPreferencesProfileConfiguration(installed, row), error => error.code === 'duplicate');
  const conflicting = parsePreferencesProfile(profile(payload('com.apple.applicationaccess', { allowCamera: true }, { id: 'other.payload', number: 7 }), { id: 'other.profile' }));
  assert.throws(() => buildPreferencesProfileConfiguration(installed, conflicting), error => error.code === 'unsupported_profile');
  assert.deepEqual(installed, installedBefore);
  configuration.parental.allowCamera = 'true';
  assert.throws(() => buildPreferencesProfileConfiguration(configuration, row));
  assert.equal(configuration.profiles.rows.length, 0);
});

test('independent profile controls coexist while candidate growth and cyclic/noncanonical inputs fail closed', () => {
  const camera = parsePreferencesProfile(profile(restrictions({ allowCamera: false })));
  const firewallRow = parsePreferencesProfile(profile(firewall({ EnableFirewall: true }), { id: 'other.profile' }));
  const installed = buildPreferencesProfileConfiguration(buildPreferencesProfileConfiguration(preferencesConfigurationDefaults(), camera), firewallRow);
  assert.equal(installed.profiles.rows.length, 2);
  assert.equal(installed.parental.allowCamera, false);
  assert.equal(installed.security.firewall, true);
  const cyclic = preferencesConfigurationDefaults(); cyclic.self = cyclic;
  assert.throws(() => buildPreferencesProfileConfiguration(cyclic, camera));
  const accessor = preferencesConfigurationDefaults();
  Object.defineProperty(accessor, 'hostValue', { enumerable: true, get() { throw new Error('must not access'); } });
  assert.throws(() => buildPreferencesProfileConfiguration(accessor, camera), /ordinary canonical properties/u);
  const oversized = preferencesConfigurationDefaults(); oversized.padding = Array(5).fill('x'.repeat(PREFERENCES_PROFILE_FILE_LIMIT));
  assert.throws(() => buildPreferencesProfileConfiguration(oversized, camera), error => error.code === 'limit_exceeded');
});
