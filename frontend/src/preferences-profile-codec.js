import { copyCanonicalData, canonicalStringUnits } from './canonical-data.js';

export const PREFERENCES_PROFILE_FILE_LIMIT = 1024 * 1024;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const unsafeKeys = new Set(['__proto__', 'constructor', 'prototype']);
const metadata = new Set(['PayloadType', 'PayloadIdentifier', 'PayloadUUID', 'PayloadVersion', 'PayloadDisplayName', 'PayloadOrganization', 'PayloadDescription', 'PayloadEnabled']);
// Apple Device Management payload schemas; evidence: local://preferences-profile-evidence.md.
const payloadControls = {
  'com.apple.applicationaccess': { allowCamera: 'parental.allowCamera', allowMultiplayerGaming: 'parental.allowMultiplayer' },
  'com.apple.security.firewall': { EnableFirewall: 'security.firewall', BlockAllIncoming: 'security.blockIncoming', EnableStealthMode: 'security.stealth' },
};
const controls = new Set(Object.values(payloadControls).flatMap(mapping => Object.values(mapping)));
function fail(message, code = 'invalid_profile') { const error = new Error(message); error.code = code; throw error; }
const dictionary = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
function xmlTextValid(text) {
  for (const char of text) {
    const n = char.codePointAt(0);
    if (!(n === 9 || n === 10 || n === 13 || n >= 32 && n <= 0xD7FF || n >= 0xE000 && n <= 0xFFFD || n >= 0x10000 && n <= 0x10FFFF)) return false;
  }
  return true;
}
function decodeXML(text) {
  if (text.includes('<') || text.includes(']]>')) fail('Malformed XML character data.');
  const known = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  let result = '', at = 0;
  for (;;) {
    const start = text.indexOf('&', at);
    if (start < 0) return result + text.slice(at);
    result += text.slice(at, start);
    const end = text.indexOf(';', start + 1);
    if (end < 0) fail('Unterminated XML entity.');
    const entity = text.slice(start + 1, end);
    if (Object.hasOwn(known, entity)) result += known[entity];
    else {
      if (!/^#(?:[0-9]+|x[0-9a-fA-F]+)$/u.test(entity)) fail('Unknown or external XML entity.', 'unsupported_profile');
      const number = entity[1] === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      if (!Number.isSafeInteger(number) || number < 0 || number > 0x10FFFF) fail('Invalid XML character reference.');
      const char = String.fromCodePoint(number);
      if (!xmlTextValid(char)) fail('Invalid XML character reference.');
      result += char;
    }
    at = end + 1;
  }
}
function parseXMLPlist(source) {
  if (typeof source !== 'string') fail('Configuration profiles require XML text; binary/CMS profiles are unsupported.', 'unsupported_profile');
  if (source.length > PREFERENCES_PROFILE_FILE_LIMIT) fail('Configuration profile exceeds the 1 Mi text-unit File limit.', 'limit_exceeded');
  if (!xmlTextValid(source)) fail('Invalid XML characters.');
  const xml = source.replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n');
  if (xml.startsWith('bplist')) fail('Binary configuration profiles are unsupported.', 'unsupported_profile');
  let at = 0, nodes = 0;
  const match = expression => { expression.lastIndex = at; const result = expression.exec(xml); if (result) at = expression.lastIndex; return result; };
  const whitespace = /[\t\n ]+/y;
  function skip() {
    for (;;) {
      match(whitespace);
      if (!xml.startsWith('<!--', at)) return;
      const end = xml.indexOf('-->', at + 4);
      if (end < 0 || xml.slice(at + 4, end).includes('--') || xml[end - 1] === '-') fail('Malformed XML comment.');
      at = end + 3;
    }
  }
  skip();
  if (xml.startsWith('<?xml', at)) {
    if (!match(/<\?xml[\t\n ]+version=(?:"1\.0"|'1\.0')(?:[\t\n ]+encoding=(?:"[Uu][Tt][Ff]-8"|'[Uu][Tt][Ff]-8'))?(?:[\t\n ]+standalone=(?:"(?:yes|no)"|'(?:yes|no)'))?[\t\n ]*\?>/y)) fail('Unsupported XML declaration.', 'unsupported_profile');
  }
  skip();
  if (xml.startsWith('<!DOCTYPE', at)) {
    // Recognize only Apple's fixed plist declaration; never resolve its URL.
    if (!match(/<!DOCTYPE[\t\n ]+plist[\t\n ]+PUBLIC[\t\n ]+(?:"-\/\/Apple\/\/DTD PLIST 1\.0\/\/EN"|'-\/\/Apple\/\/DTD PLIST 1\.0\/\/EN')[\t\n ]+(?:"https?:\/\/www\.apple\.com\/DTDs\/PropertyList-1\.0\.dtd"|'https?:\/\/www\.apple\.com\/DTDs\/PropertyList-1\.0\.dtd')[\t\n ]*>/y)) fail('Custom DTDs, internal subsets and external entities are unsupported.', 'unsupported_profile');
  }
  skip();
  if (!match(/<plist[\t\n ]+version=(?:"1\.0"|'1\.0')[\t\n ]*>/y)) fail('Expected a genuine XML plist version 1.0; JSON, binary and signed CMS profiles are unsupported.', 'unsupported_profile');
  function value(depth = 0, allowKey = false) {
    if (depth > 16 || ++nodes > 4096) fail('Profile XML nesting or node limit exceeded.', 'limit_exceeded');
    skip();
    const tag = match(/<(dict|array|string|key|integer|real|true|false)[\t\n ]*(\/?)>/y);
    if (!tag || tag[1] === 'key' && !allowKey) fail('Malformed or unsupported plist element.');
    const type = tag[1], empty = tag[2] === '/';
    if (type === 'true' || type === 'false') {
      if (!empty) { skip(); if (!xml.startsWith(`</${type}>`, at)) fail('Boolean plist elements must be empty.'); at += type.length + 3; }
      return type === 'true';
    }
    if (type === 'dict' || type === 'array') {
      const result = type === 'dict' ? Object.create(null) : [];
      if (empty) return result;
      for (;;) {
        skip();
        if (xml.startsWith(`</${type}>`, at)) { at += type.length + 3; return result; }
        if (type === 'array') {
          if (result.length >= 128) fail('Profile array item limit exceeded.', 'limit_exceeded');
          result.push(value(depth + 1));
        } else {
          if (!/^<key[\t\n />]/u.test(xml.slice(at, at + 6))) fail('Plist dictionaries require alternating key/value elements.');
          const key = value(depth + 1, true);
          if (typeof key !== 'string') fail('Plist dictionaries require alternating key/value elements.');
          if (unsafeKeys.has(key)) fail('Unsafe profile dictionary key.');
          if (Object.hasOwn(result, key)) fail('Duplicate plist dictionary key.', 'duplicate');
          skip();
          if (key === 'PayloadVersion' && !/^<integer[\t\n />]/u.test(xml.slice(at, at + 10))) fail('PayloadVersion must use a native plist integer.');
          result[key] = value(depth + 1);
        }
      }
    }
    let text = '';
    if (!empty) {
      const end = xml.indexOf(`</${type}>`, at);
      if (end < 0) fail('Unclosed plist element.');
      text = decodeXML(xml.slice(at, end)); at = end + type.length + 3;
    }
    if (type === 'integer') {
      if (!/^[+-]?\d+$/u.test(text.trim()) || !Number.isSafeInteger(Number(text))) fail('Invalid or unsafe plist integer.');
      return Number(text);
    }
    if (type === 'real') {
      if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u.test(text.trim()) || !Number.isFinite(Number(text))) fail('Invalid plist real.');
      return Number(text);
    }
    if (text.length > 512) fail('Profile string exceeds 512 text units.', 'limit_exceeded');
    return text;
  }
  const result = value(); skip();
  if (!xml.startsWith('</plist>', at)) fail('Missing plist closing element.');
  at += 8; skip(); if (at !== xml.length) fail('Trailing XML content.');
  return result;
}
function validateMetadata(payload, ids, uuids, top = false) {
  if (!dictionary(payload)) fail('Profile and payloads must be plist dictionaries.');
  if (typeof payload.PayloadIdentifier !== 'string' || !ID.test(payload.PayloadIdentifier)) fail('PayloadIdentifier requires a bounded safe native identifier.');
  if (typeof payload.PayloadUUID !== 'string' || !UUID.test(payload.PayloadUUID)) fail('PayloadUUID requires a UUID string.');
  if (payload.PayloadVersion !== 1) fail('Only integer PayloadVersion 1 is supported.', 'unsupported_profile');
  if (ids.has(payload.PayloadIdentifier) || uuids.has(payload.PayloadUUID.toLowerCase())) fail('Duplicate payload identifier or UUID.', 'duplicate');
  ids.add(payload.PayloadIdentifier); uuids.add(payload.PayloadUUID.toLowerCase());
  for (const key of ['PayloadDisplayName', 'PayloadOrganization', 'PayloadDescription']) if (Object.hasOwn(payload, key) && typeof payload[key] !== 'string') fail(key + ' must be a string.');
  if (Object.hasOwn(payload, 'PayloadEnabled')) {
    if (typeof payload.PayloadEnabled !== 'boolean') fail('PayloadEnabled must be a boolean.');
    if (!payload.PayloadEnabled) fail('Disabled payloads are unsupported; no setting will be silently applied.', 'unsupported_profile');
  }
  if (Object.hasOwn(payload, 'PayloadScope') && (!top || payload.PayloadScope !== 'System')) fail('Only top-level System scope is modeled; User/per-payload scopes are unsupported.', 'unsupported_profile');
}
/** Parse a native unsigned XML .mobileconfig, rejecting every unmodeled payload or key. */
export function parsePreferencesProfile(source) {
  const root = parseXMLPlist(source), ids = new Set(), uuids = new Set();
  validateMetadata(root, ids, uuids, true);
  if (root.PayloadType !== 'Configuration') fail('The top-level PayloadType must be Configuration.');
  for (const key of Object.keys(root)) if (!metadata.has(key) && !['PayloadScope', 'PayloadContent', 'PayloadRemovalDisallowed'].includes(key)) fail('Unsupported profile property: ' + key, 'unsupported_profile');
  if (Object.hasOwn(root, 'PayloadRemovalDisallowed') && root.PayloadRemovalDisallowed !== false) fail('Non-removable profiles are unsupported in the local scene.', 'unsupported_profile');
  if (!Array.isArray(root.PayloadContent) || root.PayloadContent.length === 0) fail('Configuration requires a nonempty PayloadContent array.');
  const settings = [], seenControls = new Set();
  for (const payload of root.PayloadContent) {
    validateMetadata(payload, ids, uuids);
    if (typeof payload.PayloadType !== 'string' || !Object.hasOwn(payloadControls, payload.PayloadType)) fail('Unsupported payload type: ' + String(payload.PayloadType) + '. MCX desktop/Dock and custom preference domains are not modeled.', 'unsupported_profile');
    const mapping = payloadControls[payload.PayloadType];
    if (payload.PayloadType === 'com.apple.security.firewall' && !Object.hasOwn(payload, 'EnableFirewall')) fail('Firewall payload requires EnableFirewall.');
    let count = 0;
    for (const key of Object.keys(payload)) {
      if (metadata.has(key)) continue;
      if (!Object.hasOwn(mapping, key)) fail('Unsupported ' + payload.PayloadType + ' property: ' + key, 'unsupported_profile');
      if (typeof payload[key] !== 'boolean') fail(key + ' requires a native plist boolean, not a string or number.');
      const controlId = mapping[key], id = payload.PayloadIdentifier + '.' + key;
      if (!ID.test(id)) fail('Derived setting identifier exceeds the bounded safe identity limit.', 'limit_exceeded');
      if (seenControls.has(controlId)) fail('Duplicate target control: ' + controlId, 'duplicate');
      seenControls.add(controlId); settings.push({ id, controlId, value: payload[key] }); count++;
    }
    if (!count) fail('Payload has no supported settings.');
  }
  return { id: root.PayloadIdentifier, name: root.PayloadDisplayName || root.PayloadIdentifier, organization: root.PayloadOrganization ?? '', description: root.PayloadDescription ?? '', settings };
}
/** Closed canonical profile-row validation, including each setting's actual typed control. */
export function validatePreferencesProfile(profile) {
  try {
    if (!dictionary(profile) || Object.keys(profile).length !== 5 || !['id', 'name', 'organization', 'description', 'settings'].every(key => Object.hasOwn(profile, key))) fail('Profile row requires the closed canonical shape.');
    if (typeof profile.id !== 'string' || !ID.test(profile.id)) fail('Invalid profile identifier.');
    for (const key of ['name', 'organization', 'description']) if (typeof profile[key] !== 'string' || profile[key].length > 512 || !xmlTextValid(profile[key])) fail('Invalid profile metadata.');
    if (!profile.name || !Array.isArray(profile.settings) || !profile.settings.length || profile.settings.length > controls.size) fail('Invalid profile settings.');
    const ids = new Set(), targets = new Set();
    for (const setting of profile.settings) {
      if (!dictionary(setting) || Object.keys(setting).length !== 3 || !['id', 'controlId', 'value'].every(key => Object.hasOwn(setting, key)) || typeof setting.id !== 'string' || !ID.test(setting.id) || !controls.has(setting.controlId) || typeof setting.value !== 'boolean') fail('Profile setting must target a supported Preferences control with its native boolean type.');
      if (ids.has(setting.id) || targets.has(setting.controlId)) fail('Duplicate profile setting.', 'duplicate');
      ids.add(setting.id); targets.add(setting.controlId);
    }
    return { ok: true };
  } catch (error) { return { ok: false, message: error.message }; }
}
/** Produce the entire candidate Preferences configuration; never mutate live/shared masters. */
export function buildPreferencesProfileConfiguration(configuration, profile) {
  const valid = validatePreferencesProfile(profile);
  if (!valid.ok) fail(valid.message);
  let nodes = 0;
  const seen = new Set();
  function bounded(value, depth = 0) {
    if (depth > 24 || ++nodes > 65536) fail('Configuration nesting or node limit exceeded.', 'limit_exceeded');
    if (value === null || typeof value === 'boolean') return;
    if (typeof value === 'string') { if (value.length > PREFERENCES_PROFILE_FILE_LIMIT) fail('Configuration string limit exceeded.', 'limit_exceeded'); return; }
    if (typeof value === 'number' && Number.isFinite(value)) return;
    if (typeof value !== 'object' || !Array.isArray(value) && !dictionary(value) || seen.has(value)) fail('Configuration must be acyclic canonical data.');
    seen.add(value);
    for (const key of Reflect.ownKeys(value)) {
      if (Array.isArray(value) && key === 'length') continue;
      if (typeof key !== 'string' || unsafeKeys.has(key)) fail('Unsafe configuration property.');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) fail('Configuration requires ordinary canonical properties.');
      bounded(descriptor.value, depth + 1);
    }
    seen.delete(value);
  }
  bounded(configuration);
  if (!dictionary(configuration) || !dictionary(configuration.profiles) || !Array.isArray(configuration.profiles.rows)) fail('Original complete Preferences configuration is required.');
  const rows = configuration.profiles.rows;
  if (rows.length >= 128) fail('Installed profile limit exceeded.', 'limit_exceeded');
  if (rows.some(row => !validatePreferencesProfile(row).ok)) fail('Existing profile rows must be valid canonical profiles.');
  if (rows.some(row => row.id === profile.id)) fail('That profile identifier is already installed.', 'duplicate');
  const incomingIds = new Set(profile.settings.map(setting => setting.id));
  const incomingControls = new Set(profile.settings.map(setting => setting.controlId));
  if (rows.some(row => row.settings.some(setting => incomingIds.has(setting.id) || incomingControls.has(setting.controlId)))) fail('Overlapping installed profile settings are unsupported; remove the conflicting profile first.', 'unsupported_profile');
  const candidate = copyCanonicalData(configuration);
  for (const setting of profile.settings) {
    const [section, key] = setting.controlId.split('.');
    if (!dictionary(candidate[section]) || !Object.hasOwn(candidate[section], key) || typeof candidate[section][key] !== typeof setting.value) fail('Original typed Preferences target is unavailable.');
    candidate[section][key] = setting.value;
  }
  candidate.profiles.rows.push(copyCanonicalData(profile));
  if (canonicalStringUnits(candidate) > 4 * PREFERENCES_PROFILE_FILE_LIMIT) fail('Candidate configuration exceeds the complete-scene text ceiling.', 'limit_exceeded');
  return candidate;
}
