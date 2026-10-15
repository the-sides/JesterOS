import test from 'node:test';
import assert from 'node:assert/strict';
import { bytesFromFile, encodeDiskImage, decodeDiskImage, createVirtualBootDemoImage } from './disk-image-codec.js';

const fixture = [
  { path: 'Documents', kind: 'folder' },
  { path: 'Documents/Read me.txt', kind: 'document', content: 'Scene notes: café.\n' },
  { path: 'Documents/Nested', kind: 'folder' },
  { path: 'Documents/Nested/pixels.bin', kind: 'document', content: 'AP+AQQ==', encoding: 'base64' },
  { path: 'Empty', kind: 'folder' },
];
const imageBytes = output => bytesFromFile(output);
const text = (bytes, offset, length) => String.fromCharCode(...bytes.subarray(offset, offset + length));

for (const format of ['iso', 'vhd']) {
  test(`${format} exports a real hierarchical filesystem, including binary bytes and empty folders`, () => {
    const output = encodeDiskImage(fixture, { format, label: 'SCENE_DISK' });
    const bytes = imageBytes(output);
    assert.equal(output.encoding, 'base64');
    assert.equal(output.byteLength, bytes.length);
    assert.equal(text(bytes, 16 * 2048 + 1, 5), 'CD001');
    if (format === 'vhd') {
      assert.equal(text(bytes, bytes.length - 512, 8), 'conectix');
      assert.equal(new DataView(bytes.buffer).getUint32(bytes.length - 512 + 60), 2);
    }
    const result = decodeDiskImage(bytes);
    assert.equal(result.format, format);
    assert.equal(result.label, 'SCENE_DISK');
    assert.equal(result.bootable, false);
    assert.deepEqual(result.entries.filter(entry => entry.kind === 'folder').map(entry => entry.path).sort(), ['Documents', 'Documents/Nested', 'Empty']);
    const notes = result.entries.find(entry => entry.path === 'Documents/Read me.txt');
    assert.equal(new TextDecoder().decode(bytesFromFile(notes)), 'Scene notes: café.\n');
    assert.deepEqual([...bytesFromFile(result.entries.find(entry => entry.path === 'Documents/Nested/pixels.bin'))], [0, 255, 128, 65]);
    assert.equal(result.capacityBytes, format === 'vhd' ? bytes.length - 512 : bytes.length);
  });
}

test('Files text, canonical base64, and binary data URLs retain actual bytes', () => {
  assert.deepEqual([...bytesFromFile({ content: 'AP+AQQ==', encoding: 'base64' })], [0, 255, 128, 65]);
  assert.deepEqual([...bytesFromFile({ content: 'data:application/octet-stream;base64,AP+AQQ==' })], [0, 255, 128, 65]);
  assert.deepEqual([...bytesFromFile({ content: 'data:application/octet-stream,%00%FF%80A' })], [0, 255, 128, 65]);
  assert.equal(new TextDecoder().decode(bytesFromFile({ content: 'café' })), 'café');
  assert.throws(() => bytesFromFile({ content: 'AP+AQR==', encoding: 'base64' }), /base64/i);
  assert.throws(() => bytesFromFile({ content: 'data:application/octet-stream,%Q0' }), /data URI/i);
});

// Independently authored ISO sectors, not a codec-produced fixture. The layout
// follows ISO9660 directory records/path tables and the El Torito catalog layout.
function externalISO({ boot = false } = {}) {
  const bytes = new Uint8Array(25 * 2048), view = new DataView(bytes.buffer);
  const put = (at, value) => { for (let i = 0; i < value.length; i++) bytes[at + i] = value.charCodeAt(i); };
  const dual16 = (at, value) => { view.setUint16(at, value, true); view.setUint16(at + 2, value); };
  const dual32 = (at, value) => { view.setUint32(at, value, true); view.setUint32(at + 4, value); };
  const descriptor = (sector, type) => { const at = sector * 2048; bytes[at] = type; put(at + 1, 'CD001'); bytes[at + 6] = 1; return at; };
  const pvd = descriptor(boot ? 17 : 16, 1);
  put(pvd + 40, 'EXTERNAL'.padEnd(32));
  dual32(pvd + 80, 25); dual16(pvd + 120, 1); dual16(pvd + 124, 1);
  dual16(pvd + 128, 2048); dual32(pvd + 132, 10);
  view.setUint32(pvd + 140, 19, true); view.setUint32(pvd + 148, 20);
  descriptor(boot ? 18 : 17, 255);
  function directoryRecord(at, sector, size, folder, name) {
    const identifier = typeof name === 'number' ? Uint8Array.of(name) : new TextEncoder().encode(name);
    const length = 33 + identifier.length + (identifier.length % 2 ? 0 : 1);
    bytes[at] = length; dual32(at + 2, sector); dual32(at + 10, size);
    bytes.set([100, 1, 1, 0, 0, 0, 0], at + 18);
    bytes[at + 25] = folder ? 2 : 0; dual16(at + 28, 1);
    bytes[at + 32] = identifier.length; bytes.set(identifier, at + 33);
    return length;
  }
  directoryRecord(pvd + 156, 21, 2048, true, 0);
  for (const [sector, little] of [[19, true], [20, false]]) {
    const at = sector * 2048; bytes[at] = 1;
    view.setUint32(at + 2, 21, little); view.setUint16(at + 6, 1, little);
  }
  let at = 21 * 2048;
  at += directoryRecord(at, 21, 2048, true, 0);
  at += directoryRecord(at, 21, 2048, true, 1);
  directoryRecord(at, 24, 3, false, 'NOTE.BIN;1');
  bytes.set([0, 255, 42], 24 * 2048);
  if (boot) {
    const record = descriptor(16, 0); put(record + 7, 'EL TORITO SPECIFICATION');
    view.setUint32(record + 71, 22, true);
    const catalog = 22 * 2048;
    bytes[catalog] = 1; bytes[catalog + 30] = 0x55; bytes[catalog + 31] = 0xaa;
    let sum = 0; for (let i = 0; i < 32; i += 2) sum += view.getUint16(catalog + i, true);
    view.setUint16(catalog + 28, (-sum) & 0xffff, true);
    bytes[catalog + 32] = 0x88; view.setUint16(catalog + 38, 1, true); view.setUint32(catalog + 40, 23, true);
    bytes.set([0xeb, 0xfe], 23 * 2048); bytes[23 * 2048 + 510] = 0x55; bytes[23 * 2048 + 511] = 0xaa;
  }
  return bytes;
}

test('reads independently authored ISO9660 directories and exact binary payloads', () => {
  const result = decodeDiskImage(externalISO());
  assert.equal(result.label, 'EXTERNAL');
  assert.equal(result.capacityBytes, 51200);
  assert.deepEqual(result.entries, [{ path: 'NOTE.BIN', kind: 'document', content: 'AP8q', encoding: 'base64', mime: 'application/octet-stream' }]);
});

test('reads genuine Joliet UTF-16BE names instead of primary ASCII aliases', () => {
  const bytes = externalISO(), view = new DataView(bytes.buffer), pvd = 16 * 2048, svd = 17 * 2048;
  bytes.copyWithin(svd, pvd, pvd + 2048); bytes[svd] = 2;
  bytes.set([37, 47, 69], svd + 88);
  bytes.fill(0, svd + 40, svd + 72);
  for (const [i, char] of [...'上映'].entries()) view.setUint16(svd + 40 + i * 2, char.charCodeAt(0));
  bytes.fill(0, 18 * 2048, 19 * 2048);
  bytes[18 * 2048] = 255; bytes.set(new TextEncoder().encode('CD001'), 18 * 2048 + 1); bytes[18 * 2048 + 6] = 1;
  const file = 21 * 2048 + 68, name = '映画.txt;1';
  bytes[file] = 33 + name.length * 2 + 1; bytes[file + 32] = name.length * 2;
  bytes.fill(0, file + 33, file + bytes[file]);
  for (let i = 0; i < name.length; i++) view.setUint16(file + 33 + i * 2, name.charCodeAt(i));
  const result = decodeDiskImage(bytes);
  assert.equal(result.label, '上映');
  assert.equal(result.entries[0].path, '映画.txt');
  assert.deepEqual([...bytesFromFile(result.entries[0])], [0, 255, 42]);
});

test('El Torito bootability requires an actual catalog, checksum, platform and bounded boot image', () => {
  assert.equal(decodeDiskImage(externalISO({ boot: true })).bootable, true);
  assert.equal(decodeDiskImage(imageBytes(encodeDiskImage([{ path: 'boot.txt', kind: 'document', content: 'EL TORITO SPECIFICATION 55 AA bootable' }], { format: 'iso' }))).bootable, false);
  for (const [offset, value, expected] of [
    [22 * 2048 + 30, 0, /signature/i],
    [22 * 2048 + 1, 0x99, /platform/i],
    [22 * 2048 + 4, 1, /checksum/i],
  ]) {
    const bytes = externalISO({ boot: true }); bytes[offset] = value;
    assert.throws(() => decodeDiskImage(bytes), expected);
  }
  const bytes = externalISO({ boot: true });
  new DataView(bytes.buffer).setUint32(22 * 2048 + 40, 999, true);
  assert.throws(() => decodeDiskImage(bytes), /boot image.*bounds/i);
});

test('optional no-emulation boot images produce real catalogs and retain the exact supplied sector bytes', () => {
  const bootImage = new Uint8Array(512);
  bootImage.set([0xfa, 0xf4, 0xeb, 0xfd]); bootImage[510] = 0x55; bootImage[511] = 0xaa;
  for (const [bootPlatform, platformByte] of [['x86', 0], ['efi', 0xef]]) {
    const bytes = imageBytes(encodeDiskImage(fixture, { format: 'iso', label: 'BOOT_TEST', bootImage, bootPlatform }));
    const view = new DataView(bytes.buffer), record = 17 * 2048;
    assert.equal(bytes[record], 0);
    assert.equal(text(bytes, record + 7, 23), 'EL TORITO SPECIFICATION');
    const catalog = view.getUint32(record + 71, true) * 2048;
    assert.equal(bytes[catalog + 1], platformByte);
    assert.deepEqual([...bytes.subarray(catalog + 30, catalog + 34)], [0x55, 0xaa, 0x88, 0]);
    const image = view.getUint32(catalog + 40, true) * 2048;
    assert.equal(view.getUint16(catalog + 38, true), 1);
    assert.deepEqual(bytes.subarray(image, image + 512), bootImage);
    const result = decodeDiskImage(bytes);
    assert.equal(result.bootable, true);
    assert.equal(new TextDecoder().decode(bytesFromFile(result.entries.find(entry => entry.path === 'Documents/Read me.txt'))), 'Scene notes: café.\n');
  }
  assert.throws(() => encodeDiskImage([], { bootImage: new Uint8Array(512) }), /boot.*signature/i);
  assert.throws(() => encodeDiskImage([], { bootImage: new Uint8Array(511) }), /512-byte/i);
  assert.throws(() => encodeDiskImage([], { bootImage, bootPlatform: 'arm64' }), /platform/i);
  assert.throws(() => encodeDiskImage([], { bootPlatform: 'x86' }), /requires.*boot image/i);
  const huge = new Uint8Array(768 * 1024); huge[510] = 0x55; huge[511] = 0xaa;
  assert.throws(() => encodeDiskImage([], { bootImage: huge }), /output exceeds/i);
});

test('virtual boot demo is explicitly disclosed and contains actual BIOS print-and-halt machine code', () => {
  const output = createVirtualBootDemoImage(), bytes = imageBytes(output), view = new DataView(bytes.buffer);
  const image = decodeDiskImage(bytes);
  assert.equal(image.label, 'JESTEROS_BOOT_DEMO');
  assert.equal(image.bootable, true);
  assert.match(new TextDecoder().decode(bytesFromFile(image.entries.find(entry => entry.path === 'README.txt'))), /not a Windows installer/i);
  const catalog = view.getUint32(17 * 2048 + 71, true) * 2048;
  const boot = view.getUint32(catalog + 40, true) * 2048;
  assert.equal(bytes[catalog + 1], 0);
  // Independent expected 16-bit instructions: CLI, XOR AX,AX; DS/SS setup,
  // stack setup, STI/CLD; SI=7C21; LODSB; BIOS INT10 teletype; CLI/HLT loop.
  assert.deepEqual([...bytes.subarray(boot, boot + 33)], [
    0xfa, 0x31, 0xc0, 0x8e, 0xd8, 0x8e, 0xd0, 0xbc, 0x00, 0x7c,
    0xfb, 0xfc, 0xbe, 0x21, 0x7c, 0xac, 0x84, 0xc0, 0x74, 0x09,
    0xb4, 0x0e, 0xbb, 0x07, 0x00, 0xcd, 0x10, 0xeb, 0xf2, 0xfa, 0xf4, 0xeb, 0xfd,
  ]);
  assert.equal(text(bytes, boot + 33, 28), 'JesterOS virtual boot demo\r\n');
  assert.deepEqual([...bytes.subarray(boot + 510, boot + 512)], [0x55, 0xaa]);
});

test('ISO endian disagreements, out-of-bounds extents, recursive directories and truncation are rejected', () => {
  const endian = externalISO(); new DataView(endian.buffer).setUint32(16 * 2048 + 84, 26);
  assert.throws(() => decodeDiskImage(endian), /endian/i);
  const extent = externalISO(), view = new DataView(extent.buffer), file = 21 * 2048 + 68;
  view.setUint32(file + 2, 900, true); view.setUint32(file + 6, 900);
  assert.throws(() => decodeDiskImage(extent), /extent.*bounds/i);
  const recursive = externalISO(), recursiveView = new DataView(recursive.buffer);
  recursive[file + 25] = 2;
  recursiveView.setUint32(file + 2, 21, true); recursiveView.setUint32(file + 6, 21);
  recursiveView.setUint32(file + 10, 2048, true); recursiveView.setUint32(file + 14, 2048);
  assert.throws(() => decodeDiskImage(recursive), /recursive/i);
  assert.throws(() => decodeDiskImage(externalISO().subarray(0, 24 * 2048)), /bounds/i);
  const tables = externalISO(); new DataView(tables.buffer).setUint32(20 * 2048 + 2, 24);
  assert.throws(() => decodeDiskImage(tables), /path tables disagree/i);
  const crossSector = externalISO();
  crossSector[21 * 2048] = 33;
  assert.throws(() => decodeDiskImage(crossSector), /directory record/i);
  const payloadMetadata = externalISO(), metadataView = new DataView(payloadMetadata.buffer);
  metadataView.setUint32(file + 2, 16, true); metadataView.setUint32(file + 6, 16);
  assert.throws(() => decodeDiskImage(payloadMetadata), /overlaps filesystem metadata/i);
});

function repairFooter(bytes) {
  const at = bytes.length - 512, view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint32(at + 64, 0);
  let sum = 0; for (let i = at; i < bytes.length; i++) sum += bytes[i];
  view.setUint32(at + 64, (~sum) >>> 0);
}

test('VHD validates the fixed footer checksum, type, disk capacity and real payload filesystem', () => {
  const make = () => imageBytes(encodeDiskImage(fixture, { format: 'vhd' }));
  const corrupt = make(); corrupt[corrupt.length - 512 + 28] ^= 1;
  assert.throws(() => decodeDiskImage(corrupt), /checksum/i);
  const cookie = make(); cookie[cookie.length - 512] ^= 1;
  assert.throws(() => decodeDiskImage(cookie), /VHD footer/i);
  const dynamic = make(); new DataView(dynamic.buffer).setUint32(dynamic.length - 512 + 60, 3); repairFooter(dynamic);
  assert.throws(() => decodeDiskImage(dynamic), /only fixed/i);
  const capacity = make(); new DataView(capacity.buffer).setBigUint64(capacity.length - 512 + 48, 512n); repairFooter(capacity);
  assert.throws(() => decodeDiskImage(capacity), /capacity/i);
  const unsupported = make(); unsupported.fill(0, 0, unsupported.length - 512);
  assert.throws(() => decodeDiskImage(unsupported), error => error.code === 'unsupported_filesystem' && /FAT\/NTFS/i.test(error.message));
});

test('reads an independently authored fixed VHD footer around real ISO sectors', () => {
  const payload = externalISO(), bytes = new Uint8Array(payload.length + 512), view = new DataView(bytes.buffer);
  bytes.set(payload);
  const at = payload.length;
  bytes.set(new TextEncoder().encode('conectix'), at);
  view.setUint32(at + 8, 2); view.setUint32(at + 12, 0x10000);
  bytes.fill(255, at + 16, at + 24);
  bytes.set(new TextEncoder().encode('test'), at + 28); view.setUint32(at + 32, 0x10000);
  bytes.set(new TextEncoder().encode('Wi2k'), at + 36);
  view.setBigUint64(at + 40, BigInt(payload.length)); view.setBigUint64(at + 48, BigInt(payload.length));
  view.setUint16(at + 56, 1); bytes[at + 58] = 4; bytes[at + 59] = 17; view.setUint32(at + 60, 2);
  bytes.set([0x76, 0xc0, 0xf5, 0x88, 0xe6, 0x70, 0x42, 0x10, 0xb1, 0xed, 0xa8, 0x73, 0x25, 0x3b, 0x49, 0x8a], at + 68);
  repairFooter(bytes);
  const image = decodeDiskImage(bytes);
  assert.equal(image.format, 'vhd');
  assert.equal(image.capacityBytes, 51200);
  assert.deepEqual([...bytesFromFile(image.entries[0])], [0, 255, 42]);
});

test('explicitly refuses UDF, UDIF/DMG and JSON pretending to be an image', () => {
  const udf = new Uint8Array(36 * 2048); udf.set(new TextEncoder().encode('BEA01'), 16 * 2048 + 1);
  assert.throws(() => decodeDiskImage(udf), /UDF.*unsupported/i);
  const dmg = new Uint8Array(512); dmg.set(new TextEncoder().encode('koly'));
  assert.throws(() => decodeDiskImage(dmg), /UDIF\/DMG.*unsupported/i);
  assert.throws(() => decodeDiskImage(new TextEncoder().encode('{\"format\":\"iso\",\"entries\":[]}')), /genuine ISO9660/i);
  assert.throws(() => encodeDiskImage([], { format: 'dmg' }), /UDIF\/DMG.*unsupported/i);
});

test('bounds apply before untrusted extent allocation or recursive expansion', () => {
  const bytes = imageBytes(encodeDiskImage(fixture, { format: 'iso' }));
  assert.throws(() => decodeDiskImage(bytes, { maxBytes: bytes.length - 1 }), /byte limit/i);
  assert.throws(() => decodeDiskImage(bytes, { maxFiles: 1 }), /file count limit/i);
  assert.throws(() => encodeDiskImage([{ path: 'huge.bin', kind: 'document', content: 'x'.repeat(768 * 1024) }], { format: 'iso' }), /output exceeds/i);
  assert.throws(() => encodeDiskImage([], { format: 'vhd', capacityBytes: 768 * 1024 }), /output exceeds/i);
  assert.throws(() => encodeDiskImage([{ path: '../outside', kind: 'document', content: '' }]), /path component/i);
  assert.throws(() => encodeDiskImage([{ path: 'same', kind: 'folder' }, { path: 'same', kind: 'document', content: '' }]), /duplicate/i);
  assert.throws(() => encodeDiskImage([{ path: 'a', kind: 'document', content: '' }, { path: 'a/b', kind: 'folder' }]), /cannot also be a folder/i);
  assert.throws(() => encodeDiskImage([{ path: Array(34).fill('deep').join('/'), kind: 'folder' }]), /nesting/i);
  const maximum = encodeDiskImage([], { format: 'iso', capacityBytes: 768 * 1024 });
  assert.equal(maximum.byteLength, 768 * 1024);
  assert.equal(maximum.content.length, 1024 * 1024);
  assert.equal(decodeDiskImage(imageBytes(maximum)).capacityBytes, 768 * 1024);
});

test('preserves non-ASCII Rock Ridge names, creates implicit ancestors, and reports actual capacity', () => {
  const result = decodeDiskImage(imageBytes(encodeDiskImage([{ path: 'Café/拍摄 🎬.txt', kind: 'document', content: 'é' }], { format: 'vhd', label: 'FILM', capacityBytes: 100000 })));
  assert.equal(result.capacityBytes, 100352);
  assert.deepEqual(result.entries.map(entry => entry.path), ['Café', 'Café/拍摄 🎬.txt']);
  assert.equal(new TextDecoder().decode(bytesFromFile(result.entries[1])), 'é');
});
