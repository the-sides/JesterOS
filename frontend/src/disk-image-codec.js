// Actual ISO9660 sectors and fixed VHD footers, never JSON containers.
// Fixed VHD exports contain ISO9660, not FAT16: FAT16's minimum 4085
// data clusters cannot fit the scene's 768 KiB binary / 1 MiB Files limit.
const MAX_BYTES = 768 * 1024, MAX_FILES = 1024, BLOCK = 2048, MAX_DEPTH = 32;
const encoder = new TextEncoder(), utf8 = new TextDecoder('utf-8', { fatal: true });
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const invalid = message => fail('invalid_content', message);
const limit = message => fail('limit_exceeded', message);
const round = (n, alignment) => Math.ceil(n / alignment) * alignment;
const ascii = (bytes, at, length) => String.fromCharCode(...bytes.subarray(at, at + length));
function putText(bytes, at, value) { for (let i = 0; i < value.length; i++) bytes[at + i] = value.charCodeAt(i); }
function base64(bytes) {
  const parts = [];
  for (let i = 0; i < bytes.length; i += 8192) parts.push(ascii(bytes, i, Math.min(8192, bytes.length - i)));
  return btoa(parts.join(''));
}
function unbase64(value) {
  if (value.length > MAX_BYTES / 3 * 4) limit('Binary content exceeds 768 KiB.');
  if (value.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) invalid('Invalid canonical base64 content.');
  let binary;
  try { binary = atob(value); } catch { invalid('Invalid base64 content.'); }
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  if (base64(bytes) !== value) invalid('Invalid canonical base64 padding.');
  return bytes;
}

export function bytesFromFile(file) {
  if (!file || typeof file.content !== 'string') fail('invalid_arguments', 'Expected a file with string content.');
  const { content, encoding } = file;
  if (content.startsWith('data:')) {
    const comma = content.indexOf(',');
    if (comma < 5 || comma > 1024) invalid('Invalid binary data URI.');
    const header = content.slice(5, comma), body = content.slice(comma + 1);
    if (/;base64$/i.test(header)) return unbase64(body);
    if (encoding && encoding !== 'utf8' && encoding !== 'utf-8') invalid('Data URI encoding disagrees with file encoding.');
    if (body.length > MAX_BYTES * 3) limit('Binary data URI exceeds 768 KiB.');
    // Percent encoding represents bytes, not necessarily UTF-8 text.
    let size = 0;
    for (let i = 0; i < body.length; i++, size++) {
      if (body[i] === '%') {
        if (!/^[0-9a-f]{2}$/i.test(body.slice(i + 1, i + 3))) invalid('Invalid percent-encoded data URI.');
        i += 2;
      } else if (body.charCodeAt(i) > 127) invalid('Non-ASCII data URI bytes must be percent encoded.');
    }
    if (size > MAX_BYTES) limit('Binary data URI exceeds 768 KiB.');
    const bytes = new Uint8Array(size);
    for (let i = 0, j = 0; i < body.length; i++, j++) {
      bytes[j] = body[i] === '%' ? parseInt(body.slice(i + 1, i + 3), 16) : body.charCodeAt(i);
      if (body[i] === '%') i += 2;
    }
    return bytes;
  }
  if (encoding === 'base64') return unbase64(content);
  if (encoding && !['utf8', 'utf-8', 'text'].includes(encoding)) fail('unsupported_encoding', 'Only UTF-8 text and base64 binary Files are supported.');
  if (content.length > MAX_BYTES) limit('File content exceeds 768 KiB.');
  // Count UTF-8 bytes before allocating the encoded buffer.
  let length = 0;
  for (const char of content) {
    const point = char.codePointAt(0);
    length += point < 128 ? 1 : point < 2048 ? 2 : point < 65536 ? 3 : 4;
    if (length > MAX_BYTES) limit('File content exceeds 768 KiB.');
  }
  return encoder.encode(content);
}
function nameBytes(name) {
  if (typeof name !== 'string' || !name || name === '.' || name === '..' || /[\/\\\x00-\x1f\x7f]/.test(name) || name.length > 180) invalid('Invalid disk image path component.');
  // Names round-trip exactly; reject lone surrogates instead of replacing them.
  for (let i = 0; i < name.length; i++) {
    const c = name.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      if (++i >= name.length || name.charCodeAt(i) < 0xdc00 || name.charCodeAt(i) > 0xdfff) invalid('Invalid Unicode disk image name.');
    } else if (c >= 0xdc00 && c <= 0xdfff) invalid('Invalid Unicode disk image name.');
  }
  const bytes = encoder.encode(name);
  if (bytes.length > 180) limit('Disk image names are limited to 180 UTF-8 bytes.');
  return bytes;
}
function tree(entries) {
  if (!Array.isArray(entries) || entries.length > MAX_FILES) limit('Disk images accept at most 1024 entries.');
  const root = { name: '', path: '', kind: 'folder', children: new Map(), parent: null };
  const nodes = new Map([['', root]]), explicit = new Set();
  let payload = 0;
  for (const entry of entries) {
    if (!entry || typeof entry.path !== 'string' || entry.path.length > 4096 || !['folder', 'document'].includes(entry.kind)) invalid('Expected a relative folder or document path.');
    const parts = entry.path.split('/');
    if (parts.length > MAX_DEPTH) limit('Disk image directory nesting exceeds 32 levels.');
    if (explicit.has(entry.path)) invalid('Duplicate disk image path.');
    explicit.add(entry.path);
    let parent = root, path = '';
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i], encodedName = nameBytes(name);
      path = path ? `${path}/${name}` : name;
      const kind = i === parts.length - 1 ? entry.kind : 'folder';
      let node = nodes.get(path);
      if (node && node.kind !== kind) invalid('A disk image document cannot also be a folder.');
      if (!node) {
        if (nodes.size > MAX_FILES) limit('Implicit folders exceed the 1024-entry limit.');
        node = { name, encodedName, path, kind, parent, children: kind === 'folder' ? new Map() : null };
        nodes.set(path, node); parent.children.set(name, node);
      }
      if (i === parts.length - 1 && kind === 'document') {
        node.bytes = bytesFromFile(entry); payload += node.bytes.length;
        if (payload > MAX_BYTES) limit('Disk file payloads exceed 768 KiB.');
      }
      parent = node;
    }
  }
  let serial = 0;
  for (const node of nodes.values()) {
    if (node === root) continue;
    const document = node.kind === 'document';
    const stem = node.name.toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, document ? 18 : 23) || 'ENTRY';
    const extension = document ? (node.name.includes('.') ? node.name.split('.').pop().toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 4) : '') : '';
    node.isoName = `${stem}_${(++serial).toString(36).toUpperCase().padStart(5, '0')}${document ? `.${extension};1` : ''}`;
    node.identifier = encoder.encode(node.isoName);
  }
  const dirs = [root];
  for (let i = 0; i < dirs.length; i++) {
    dirs[i].index = i + 1;
    dirs[i].ordered = [...dirs[i].children.values()].sort((a, b) => a.isoName < b.isoName ? -1 : a.isoName > b.isoName ? 1 : 0);
    dirs.push(...dirs[i].ordered.filter(node => node.kind === 'folder'));
  }
  return { root, dirs, files: [...nodes.values()].filter(node => node.kind === 'document') };
}
function both16(view, at, value) { view.setUint16(at, value, true); view.setUint16(at + 2, value); }
function both32(view, at, value) { view.setUint32(at, value, true); view.setUint32(at + 4, value); }
const rootExtensions = Uint8Array.of(
  83, 80, 7, 1, 190, 239, 0, // SUSP SP, no skipped bytes.
  69, 82, 18, 1, 10, 0, 0, 1, 82, 82, 73, 80, 95, 49, 57, 57, 49, 65, // RRIP_1991A.
);
function record(node, identifier, extensions = new Uint8Array()) {
  const length = 33 + identifier.length + (identifier.length % 2 === 0 ? 1 : 0) + extensions.length;
  if (length > 255) limit('ISO directory record exceeds 255 bytes.');
  const bytes = new Uint8Array(length), view = new DataView(bytes.buffer);
  bytes[0] = length;
  both32(view, 2, node.extent); both32(view, 10, node.size);
  bytes.set([100, 1, 1, 0, 0, 0, 0], 18); // Authored 2000-01-01, not host time.
  bytes[25] = node.kind === 'folder' ? 2 : 0;
  both16(view, 28, 1); bytes[32] = identifier.length;
  bytes.set(identifier, 33); bytes.set(extensions, length - extensions.length);
  return bytes;
}
function namedExtensions(node) {
  const bytes = new Uint8Array(5 + node.encodedName.length);
  bytes.set([78, 77, bytes.length, 1, 0]); bytes.set(node.encodedName, 5);
  return bytes;
}
function directoryRecords(dir, root) {
  return [record(dir, Uint8Array.of(0), dir === root ? rootExtensions : undefined),
    record(dir.parent || dir, Uint8Array.of(1)),
    ...dir.ordered.map(node => record(node, node.identifier, namedExtensions(node)))];
}
function directorySize(records) {
  let size = 0;
  for (const value of records) {
    if (size % BLOCK + value.length > BLOCK) size = round(size, BLOCK);
    size += value.length;
  }
  return round(size, BLOCK);
}
function writePathTable(bytes, at, dirs, little) {
  const view = new DataView(bytes.buffer);
  for (const dir of dirs) {
    const identifier = dir.identifier || Uint8Array.of(0);
    bytes[at] = identifier.length;
    view.setUint32(at + 2, dir.extent, little); view.setUint16(at + 6, dir.parent?.index || 1, little);
    bytes.set(identifier, at + 8); at += 8 + identifier.length + identifier.length % 2;
  }
}
function validateBootImage(bootImage, bootPlatform) {
  if (bootImage === undefined) {
    if (bootPlatform !== undefined) fail('invalid_arguments', 'Boot platform requires a boot image.');
    return null;
  }
  const platform = bootPlatform ?? 'x86';
  if (platform !== 'x86' && platform !== 'efi') fail('unsupported_platform', 'El Torito boot platform must be x86 or efi.');
  if (!(bootImage instanceof Uint8Array) || bootImage.length < 512 || bootImage.length % 512) fail('invalid_arguments', 'Boot image must contain complete 512-byte sectors.');
  if (bootImage.length > MAX_BYTES) limit('Boot image exceeds 768 KiB.');
  // No-emulation x86 boot sectors and EFI FAT boot sectors have this signature.
  // Supplied code/filesystem remains the caller's real image, not generated text.
  if (bootImage[510] !== 0x55 || bootImage[511] !== 0xaa) invalid('Boot image requires a 55 AA boot sector signature.');
  return { bytes: bootImage, platform: platform === 'efi' ? 0xef : 0 };
}
function makeISO(entries, label, capacityBytes, reserveFooter, boot) {
  const { root, dirs, files } = tree(entries);
  if (typeof label !== 'string' || !/^[A-Za-z0-9 _.-]{1,32}$/.test(label)) invalid('ISO labels must contain 1–32 ASCII letters, digits, spaces, underscores, dots or hyphens.');
  const tableSize = dirs.reduce((size, dir) => { const length = dir.identifier?.length || 1; return size + 8 + length + length % 2; }, 0);
  const tableBlocks = round(tableSize, BLOCK) / BLOCK;
  const pathTableSector = boot ? 19 : 18;
  let sector = pathTableSector + tableBlocks * 2;
  for (const dir of dirs) {
    // Size calculation needs no payload bytes and remains bounded by entry count.
    dir.extent = 0; dir.size = 0;
  }
  for (const file of files) { file.extent = 0; file.size = file.bytes.length; }
  for (const dir of dirs) { dir.size = directorySize(directoryRecords(dir, root)); dir.extent = sector; sector += dir.size / BLOCK; }
  for (const file of files) { file.extent = sector; sector += round(file.size, BLOCK) / BLOCK; }
  const catalogSector = boot ? sector++ : 0;
  const bootSector = boot ? sector : 0;
  if (boot) sector += round(boot.bytes.length, BLOCK) / BLOCK;
  const minimum = sector * BLOCK;
  if (capacityBytes !== undefined && (!Number.isSafeInteger(capacityBytes) || capacityBytes < minimum)) invalid(`Image capacity must be an integer of at least ${minimum} bytes.`);
  const capacity = round(capacityBytes ?? minimum, BLOCK);
  if (capacity + reserveFooter > MAX_BYTES) limit('Disk image output exceeds 768 KiB.');
  const bytes = new Uint8Array(capacity + reserveFooter), view = new DataView(bytes.buffer);
  const pvd = 16 * BLOCK;
  bytes[pvd] = 1; putText(bytes, pvd + 1, 'CD001'); bytes[pvd + 6] = 1;
  putText(bytes, pvd + 8, 'JESTEROS'.padEnd(32)); putText(bytes, pvd + 40, label.padEnd(32));
  both32(view, pvd + 80, capacity / BLOCK); both16(view, pvd + 120, 1); both16(view, pvd + 124, 1);
  both16(view, pvd + 128, BLOCK); both32(view, pvd + 132, tableSize);
  view.setUint32(pvd + 140, pathTableSector, true); view.setUint32(pvd + 148, pathTableSector + tableBlocks);
  bytes.set(record(root, Uint8Array.of(0)), pvd + 156);
  for (const at of [190, 318, 446, 574]) putText(bytes, pvd + at, ''.padEnd(128));
  putText(bytes, pvd + 574, 'JESTEROS LOCAL ISO9660'.padEnd(128));
  for (const at of [702, 739, 776]) putText(bytes, pvd + at, ''.padEnd(37));
  for (const at of [813, 830, 847, 864]) putText(bytes, pvd + at, '0000000000000000');
  bytes[pvd + 881] = 1;
  if (boot) {
    const descriptor = 17 * BLOCK, catalog = catalogSector * BLOCK;
    bytes[descriptor] = 0; putText(bytes, descriptor + 1, 'CD001'); bytes[descriptor + 6] = 1;
    putText(bytes, descriptor + 7, 'EL TORITO SPECIFICATION'); view.setUint32(descriptor + 71, catalogSector, true);
    bytes[catalog] = 1; bytes[catalog + 1] = boot.platform;
    putText(bytes, catalog + 4, 'JESTEROS BOOT IMAGE');
    bytes[catalog + 30] = 0x55; bytes[catalog + 31] = 0xaa;
    let sum = 0; for (let i = 0; i < 32; i += 2) sum += view.getUint16(catalog + i, true);
    view.setUint16(catalog + 28, (-sum) & 0xffff, true);
    bytes[catalog + 32] = 0x88; // Bootable initial entry, no emulation.
    view.setUint16(catalog + 38, boot.bytes.length / 512, true);
    view.setUint32(catalog + 40, bootSector, true);
    bytes.set(boot.bytes, bootSector * BLOCK);
  }
  const end = (boot ? 18 : 17) * BLOCK; bytes[end] = 255; putText(bytes, end + 1, 'CD001'); bytes[end + 6] = 1;
  writePathTable(bytes, pathTableSector * BLOCK, dirs, true); writePathTable(bytes, (pathTableSector + tableBlocks) * BLOCK, dirs, false);
  for (const dir of dirs) {
    let offset = dir.extent * BLOCK;
    for (const value of directoryRecords(dir, root)) {
      if (offset % BLOCK + value.length > BLOCK) offset = round(offset, BLOCK);
      bytes.set(value, offset); offset += value.length;
    }
  }
  for (const file of files) bytes.set(file.bytes, file.extent * BLOCK);
  return { bytes, capacity };
}
function vhdGeometry(sectors) {
  // Microsoft's fixed-VHD CHS algorithm; capacity is authoritative when CHS rounds.
  let heads, perTrack = 17, cylindersTimesHeads = Math.floor(sectors / perTrack);
  heads = Math.max(4, Math.ceil(cylindersTimesHeads / 1024));
  if (cylindersTimesHeads >= heads * 1024 || heads > 16) { perTrack = 31; heads = 16; cylindersTimesHeads = Math.floor(sectors / perTrack); }
  if (cylindersTimesHeads >= heads * 1024) { perTrack = 63; heads = 16; cylindersTimesHeads = Math.floor(sectors / perTrack); }
  return { cylinders: Math.floor(cylindersTimesHeads / heads), heads, perTrack };
}
function writeVHD(bytes, capacity) {
  const at = capacity, view = new DataView(bytes.buffer);
  putText(bytes, at, 'conectix'); view.setUint32(at + 8, 2); view.setUint32(at + 12, 0x10000);
  bytes.fill(255, at + 16, at + 24); putText(bytes, at + 28, 'JOS '); view.setUint32(at + 32, 0x10000); putText(bytes, at + 36, 'Wi2k');
  view.setBigUint64(at + 40, BigInt(capacity)); view.setBigUint64(at + 48, BigInt(capacity));
  const { cylinders, heads, perTrack } = vhdGeometry(capacity / 512);
  view.setUint16(at + 56, cylinders); bytes[at + 58] = heads; bytes[at + 59] = perTrack; view.setUint32(at + 60, 2);
  // Stable UUID derived from actual image bytes. Not a host/random identity.
  let hash = 2166136261;
  for (let i = 0; i < capacity; i++) hash = Math.imul(hash ^ bytes[i], 16777619) >>> 0;
  for (let i = 0; i < 16; i++) { hash = Math.imul(hash ^ i, 16777619) >>> 0; bytes[at + 68 + i] = hash >>> 24; }
  bytes[at + 74] = (bytes[at + 74] & 15) | 0x40; bytes[at + 76] = (bytes[at + 76] & 63) | 0x80;
  let sum = 0; for (let i = at; i < at + 512; i++) sum += bytes[i];
  view.setUint32(at + 64, (~sum) >>> 0);
}
export function encodeDiskImage(entries, { format = 'iso', label = 'UNTITLED', capacityBytes, bootImage, bootPlatform } = {}) {
  if (format !== 'iso' && format !== 'vhd') fail('unsupported_format', 'Only ISO9660 and fixed VHD disk images can be created; UDF and UDIF/DMG are unsupported.');
  const boot = validateBootImage(bootImage, bootPlatform);
  const { bytes, capacity } = makeISO(entries, label, capacityBytes, format === 'vhd' ? 512 : 0, boot);
  if (format === 'vhd') writeVHD(bytes, capacity);
  return { content: base64(bytes), mime: format === 'iso' ? 'application/x-iso9660-image' : 'application/x-vhd', encoding: 'base64', byteLength: bytes.length };
}

export function createVirtualBootDemoImage() {
  const bootImage = new Uint8Array(512);
  // Real-mode BIOS boot program loaded at 0000:7C00. Print the zero-terminated
  // message using INT10/AH=0E, then CLI/HLT forever. No disk writes or OS install.
  bootImage.set([
    0xfa, 0x31, 0xc0, 0x8e, 0xd8, 0x8e, 0xd0, 0xbc, 0x00, 0x7c,
    0xfb, 0xfc, 0xbe, 0x21, 0x7c, 0xac, 0x84, 0xc0, 0x74, 0x09,
    0xb4, 0x0e, 0xbb, 0x07, 0x00, 0xcd, 0x10, 0xeb, 0xf2, 0xfa, 0xf4, 0xeb, 0xfd,
  ]);
  putText(bootImage, 33, 'JesterOS virtual boot demo\r\nDEMO - not a Windows installer\r\n');
  bootImage[510] = 0x55; bootImage[511] = 0xaa;
  return encodeDiskImage([{
    path: 'README.txt', kind: 'document',
    content: 'JesterOS virtual boot demo\n\nDEMO ONLY - not a Windows installer.\nThis genuine ISO9660 image contains an x86 BIOS El Torito boot program that prints a disclosure and halts. It does not install an operating system, partition disks, or access the host. EFI boot is not included.\n',
  }], { format: 'iso', label: 'JESTEROS_BOOT_DEMO', bootImage, bootPlatform: 'x86' });
}

const FILE_MIMES = {
  txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', html: 'text/html',
  json: 'application/json', pdf: 'application/pdf', png: 'image/png',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml',
  wav: 'audio/wav', mp3: 'audio/mpeg', zip: 'application/zip', iso: 'application/x-iso9660-image',
};
const mimeFor = path => FILE_MIMES[path.split('.').pop().toLowerCase()] || 'application/octet-stream';
function parseISO(bytes, { maxBytes, maxFiles }) {
  if (bytes.length < 18 * BLOCK) invalid('Truncated ISO9660 volume.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const both = (at, width) => {
    if (at < 0 || at + width * 2 > bytes.length) invalid('Truncated ISO endian field.');
    const little = width === 4 ? view.getUint32(at, true) : view.getUint16(at, true);
    const big = width === 4 ? view.getUint32(at + width) : view.getUint16(at + width);
    if (little !== big) invalid('ISO little/big endian fields disagree.');
    return little;
  };
  let primary, joliet, terminator, bootRecord;
  for (let sector = 16; sector < 80 && (sector + 1) * BLOCK <= bytes.length; sector++) {
    const at = sector * BLOCK, signature = ascii(bytes, at + 1, 5), type = bytes[at];
    if (['BEA01', 'NSR02', 'NSR03', 'TEA01'].includes(signature)) fail('unsupported_format', 'UDF disk images are unsupported.');
    if (signature !== 'CD001' || bytes[at + 6] !== 1) invalid('Invalid ISO9660 volume descriptor signature/version.');
    if (type === 1) {
      if (primary !== undefined) invalid('Duplicate ISO primary volume descriptor.');
      primary = at;
    } else if (type === 2 && ['%/@', '%/C', '%/E'].includes(ascii(bytes, at + 88, 3))) {
      if (joliet !== undefined) invalid('Duplicate Joliet volume descriptor.');
      joliet = at;
    } else if (type === 0 && ascii(bytes, at + 7, 32).replace(/[\x00 ]+$/, '') === 'EL TORITO SPECIFICATION') {
      if (bootRecord !== undefined) invalid('Duplicate El Torito boot record.');
      bootRecord = at;
    } else if (type !== 0 && type !== 2 && type !== 255) {
      fail('unsupported_format', 'Unsupported ISO volume descriptor type.');
    }
    if (type === 255) { terminator = at; break; }
  }
  if (primary === undefined || terminator === undefined) invalid('ISO primary descriptor and terminator are required.');
  const volumeBlocks = both(primary + 80, 4), blockSize = both(primary + 128, 2);
  if (blockSize !== BLOCK) fail('unsupported_format', 'Only 2048-byte ISO9660 logical blocks are supported.');
  const volumeBytes = volumeBlocks * BLOCK;
  if (volumeBytes > bytes.length || volumeBytes < terminator + BLOCK) invalid('ISO volume size exceeds actual sector bounds.');
  if (both(primary + 120, 2) !== 1 || both(primary + 124, 2) !== 1) fail('unsupported_format', 'Multi-volume ISO sets are unsupported.');
  const selected = joliet ?? primary;
  if (selected !== primary && (both(selected + 80, 4) !== volumeBlocks || both(selected + 128, 2) !== BLOCK || both(selected + 120, 2) !== 1 || both(selected + 124, 2) !== 1)) invalid('Joliet volume geometry disagrees with ISO primary descriptor.');
  const extent = (sector, size) => {
    const at = sector * BLOCK;
    if (at > volumeBytes || size > volumeBytes - at) invalid('ISO extent exceeds volume bounds.');
    return at;
  };
  const metadata = [[16 * BLOCK, terminator + BLOCK]], files = [];
  const overlap = (a, b) => a[0] < b[1] && b[0] < a[1];
  const protect = range => {
    if (metadata.some(other => overlap(range, other))) invalid('Overlapping ISO metadata extents.');
    metadata.push(range);
  };
  // Read both mandatory path tables, including their parent hierarchy and byte order.
  const tableSize = both(selected + 132, 4);
  if (!tableSize || tableSize > maxBytes) invalid('Invalid ISO path table size.');
  const parseTable = (sector, little) => {
    const start = extent(sector, tableSize), end = start + tableSize, rows = [];
    protect([start, round(end, BLOCK)]);
    for (let at = start; at < end;) {
      if (end - at < 8) invalid('Truncated ISO path table.');
      const count = bytes[at], length = 8 + count + count % 2;
      if (!count || at + length > end || bytes[at + 1]) invalid('Invalid ISO path table record.');
      const row = { sector: view.getUint32(at + 2, little), parent: view.getUint16(at + 6, little), name: ascii(bytes, at + 8, count) };
      extent(row.sector, BLOCK);
      if (rows.length === 0 ? count !== 1 || bytes[at + 8] !== 0 || row.parent !== 1 : row.parent < 1 || row.parent > rows.length) invalid('Invalid ISO path table hierarchy.');
      rows.push(row);
      if (rows.length > maxFiles + 1) limit('ISO path table exceeds the file count limit.');
      at += length;
    }
    return rows;
  };
  const littleTable = parseTable(view.getUint32(selected + 140, true), true);
  const bigTable = parseTable(view.getUint32(selected + 148), false);
  if (littleTable.length !== bigTable.length || littleTable.some((row, i) => row.sector !== bigTable[i].sector || row.parent !== bigTable[i].parent || row.name !== bigTable[i].name)) invalid('ISO little/big endian path tables disagree.');
  function readRecord(at, end) {
    const length = bytes[at];
    if (length < 34 || at + length > end || at % BLOCK + length > BLOCK) invalid('Truncated or cross-sector ISO directory record.');
    const count = bytes[at + 32], header = 33 + count + (count % 2 === 0 ? 1 : 0);
    if (!count || header > length) invalid('Invalid ISO directory identifier length.');
    if (bytes[at + 1] || bytes[at + 26] || bytes[at + 27]) fail('unsupported_filesystem', 'Extended-attribute/interleaved ISO files are unsupported.');
    if (bytes[at + 25] & ~7) fail('unsupported_filesystem', 'Multi-extent/protected ISO records are unsupported.');
    if (both(at + 28, 2) !== 1) invalid('Invalid ISO directory volume sequence.');
    const sector = both(at + 2, 4), size = both(at + 10, 4);
    extent(sector, size);
    return { at, length, sector, size, folder: !!(bytes[at + 25] & 2), identifier: bytes.subarray(at + 33, at + 33 + count), system: at + header, end: at + length };
  }
  const root = readRecord(selected + 156, selected + BLOCK);
  if (!root.folder || root.identifier.length !== 1 || root.identifier[0] !== 0 || littleTable[0].sector !== root.sector) invalid('Invalid ISO root directory.');
  let rockRidge = false, skip = 0;
  const rootAt = extent(root.sector, root.size), dot = readRecord(rootAt, rootAt + root.size);
  if (joliet === undefined && dot.end - dot.system >= 7 && ascii(bytes, dot.system, 2) === 'SP') {
    if (bytes[dot.system + 2] !== 7 || bytes[dot.system + 3] !== 1 || bytes[dot.system + 4] !== 190 || bytes[dot.system + 5] !== 239) invalid('Invalid SUSP sharing protocol signature.');
    skip = bytes[dot.system + 6]; rockRidge = true;
  }
  function decodedName(record) {
    let name;
    if (joliet !== undefined) {
      if (record.identifier.length % 2) invalid('Odd-length Joliet identifier.');
      name = '';
      for (let i = 0; i < record.identifier.length; i += 2) name += String.fromCharCode(record.identifier[i] * 256 + record.identifier[i + 1]);
      name = name.replace(/;[0-9]+$/, '').replace(/\.$/, '');
    } else {
      if (record.identifier.some(byte => byte < 32 || byte > 126)) invalid('Invalid ISO ASCII identifier.');
      name = ascii(record.identifier, 0, record.identifier.length).replace(/;[0-9]+$/, '').replace(/\.$/, '');
    }
    if (rockRidge) {
      let nm = null, continuation = false;
      for (let at = record.system + skip; at < record.end;) {
        if (record.end - at < 4) {
          if (bytes.subarray(at, record.end).some(byte => byte !== 0)) invalid('Truncated ISO system-use entry.');
          break;
        }
        if (bytes[at] === 0 && bytes[at + 1] === 0) break;
        const signature = ascii(bytes, at, 2), length = bytes[at + 2];
        if (length < 4 || at + length > record.end || bytes[at + 3] !== 1) invalid('Invalid ISO system-use entry.');
        if (signature === 'CE') fail('unsupported_filesystem', 'Rock Ridge continuation areas are unsupported.');
        if (['SL', 'CL', 'PL', 'RE'].includes(signature)) fail('unsupported_filesystem', 'Rock Ridge symlinks/relocated directories are unsupported.');
        if (signature === 'NM') {
          if (length < 5 || bytes[at + 4] & ~1 || nm !== null && !continuation) invalid('Invalid Rock Ridge alternate name.');
          if (nm === null) nm = [];
          nm.push(bytes.subarray(at + 5, at + length)); continuation = !!(bytes[at + 4] & 1);
        }
        at += length;
        if (signature === 'ST') break;
      }
      if (continuation) invalid('Truncated Rock Ridge alternate name.');
      if (nm !== null) {
        const length = nm.reduce((sum, part) => sum + part.length, 0), joined = new Uint8Array(length);
        let at = 0; for (const part of nm) { joined.set(part, at); at += part.length; }
        try { name = utf8.decode(joined); } catch { invalid('Invalid UTF-8 Rock Ridge name.'); }
      }
    }
    nameBytes(name);
    return name;
  }
  const entries = [], directories = new Map(), paths = new Set();
  let totalPayload = 0;
  function walk(dir, path, parent, depth) {
    if (depth > MAX_DEPTH) limit('ISO directory nesting exceeds 32 levels.');
    if (directories.has(dir.sector)) invalid('Recursive or multiply-linked ISO directory extent.');
    directories.set(dir.sector, { parent: parent?.sector ?? dir.sector, identifier: ascii(dir.identifier, 0, dir.identifier.length) });
    if (!dir.size || dir.size % BLOCK) invalid('Invalid ISO directory extent size.');
    const start = extent(dir.sector, dir.size), end = start + dir.size;
    protect([start, end]);
    let dotSeen = false, parentSeen = false, ordinal = 0;
    for (let at = start; at < end;) {
      if (bytes[at] === 0) {
        const next = Math.min(round(at + 1, BLOCK), end);
        if (bytes.subarray(at, next).some(byte => byte !== 0)) invalid('Nonzero ISO directory sector padding.');
        at = next; continue;
      }
      const record = readRecord(at, end); at += record.length; ordinal++;
      if (record.identifier.length === 1 && record.identifier[0] <= 1) {
        const own = record.identifier[0] === 0, expected = own ? dir : parent || dir;
        if (!record.folder || record.sector !== expected.sector || record.size !== expected.size || own && (dotSeen || ordinal !== 1) || !own && (parentSeen || ordinal !== 2)) invalid('Invalid ISO dot/parent directory linkage.');
        if (own) dotSeen = true; else parentSeen = true;
        continue;
      }
      const name = decodedName(record), fullPath = path ? `${path}/${name}` : name;
      if (fullPath.length > 4096) limit('ISO path exceeds 4096 characters.');
      if (paths.has(fullPath)) invalid('Duplicate ISO path.');
      paths.add(fullPath);
      if (entries.length >= maxFiles) limit('ISO entries exceed the file count limit.');
      if (record.folder) {
        entries.push({ path: fullPath, kind: 'folder', content: '', encoding: 'base64', mime: 'inode/directory' });
        walk(record, fullPath, dir, depth + 1);
      } else {
        totalPayload += record.size;
        if (totalPayload > maxBytes) limit('Decoded ISO file payloads exceed the byte limit.');
        const fileAt = extent(record.sector, record.size);
        files.push([fileAt, fileAt + record.size]);
        entries.push({ path: fullPath, kind: 'document', content: base64(bytes.subarray(fileAt, fileAt + record.size)), encoding: 'base64', mime: mimeFor(fullPath) });
      }
    }
    if (!dotSeen || !parentSeen) invalid('ISO directory requires dot and parent records.');
  }
  walk(root, '', null, 0);
  if (littleTable.length !== directories.size || littleTable.some(row => {
    const actual = directories.get(row.sector);
    return !actual || actual.parent !== littleTable[row.parent - 1].sector || actual.identifier !== row.name;
  }) || new Set(littleTable.map(row => row.sector)).size !== littleTable.length) invalid('ISO path table does not describe the actual directory hierarchy.');
  if (files.some(range => metadata.some(other => overlap(range, other)))) invalid('ISO file payload overlaps filesystem metadata.');
  let label;
  if (joliet !== undefined) {
    label = ''; for (let at = selected + 40; at < selected + 72; at += 2) label += String.fromCharCode(view.getUint16(at));
  } else label = ascii(bytes, primary + 40, 32);
  label = label.replace(/[\x00 ]+$/, '');
  const bootable = bootRecord === undefined ? false : elTorito(bytes, view, view.getUint32(bootRecord + 71, true), volumeBytes);
  return { format: 'iso', label, entries, capacityBytes: volumeBytes, bootable };
}

function elTorito(bytes, view, sector, volumeBytes) {
  const at = sector * BLOCK;
  if (!sector || at + BLOCK > volumeBytes) invalid('El Torito boot catalog exceeds volume bounds.');
  if (bytes[at] !== 1 || ![0, 1, 2, 0xef].includes(bytes[at + 1]) || bytes[at + 2] || bytes[at + 3] || bytes[at + 30] !== 0x55 || bytes[at + 31] !== 0xaa) invalid('Invalid El Torito validation entry/platform/signature.');
  let sum = 0; for (let i = 0; i < 32; i += 2) sum = (sum + view.getUint16(at + i, true)) & 0xffff;
  if (sum !== 0) invalid('El Torito boot catalog checksum mismatch.');
  const bootEntry = offset => {
    const indicator = bytes[offset];
    if (indicator !== 0 && indicator !== 0x88) invalid('Invalid El Torito boot indicator.');
    if (bytes[offset + 1] > 4 || bytes[offset + 5]) invalid('Invalid El Torito boot media/reserved byte.');
    if (indicator === 0) return false;
    const count = view.getUint16(offset + 6, true), image = view.getUint32(offset + 8, true) * BLOCK;
    const size = bytes[offset + 1] === 1 ? 1200 * 1024 : bytes[offset + 1] === 2 ? 1440 * 1024 : bytes[offset + 1] === 3 ? 2880 * 1024 : count * 512;
    if (!count || !image || image > volumeBytes || size > volumeBytes - image) invalid('El Torito boot image exceeds volume bounds.');
    if (bytes[offset + 1] === 4 && (size < 512 || bytes[image + 510] !== 0x55 || bytes[image + 511] !== 0xaa)) invalid('El Torito hard disk image requires an MBR signature.');
    return true;
  };
  let bootable = bootEntry(at + 32), cursor = at + 64;
  while (cursor < at + BLOCK) {
    const type = bytes[cursor];
    if (type === 0) {
      if (bytes.subarray(cursor, at + BLOCK).some(byte => byte !== 0)) invalid('Invalid El Torito catalog padding.');
      break;
    }
    if (type !== 0x90 && type !== 0x91 || ![0, 1, 2, 0xef].includes(bytes[cursor + 1])) invalid('Invalid El Torito section header/platform.');
    const count = view.getUint16(cursor + 2, true);
    cursor += 32;
    if (!count || cursor + count * 32 > at + BLOCK) invalid('El Torito section exceeds catalog bounds.');
    for (let i = 0; i < count; i++, cursor += 32) {
      if (bytes[cursor] === 0x44) fail('unsupported_filesystem', 'El Torito extension entries are unsupported.');
      bootable = bootEntry(cursor) || bootable;
    }
    if (type === 0x91) {
      if (bytes.subarray(cursor, at + BLOCK).some(byte => byte !== 0)) invalid('Trailing El Torito catalog data.');
      break;
    }
    if (cursor === at + BLOCK || bytes[cursor] === 0) invalid('El Torito section chain has no final header.');
  }
  return bootable;
}

export function decodeDiskImage(bytes, { maxBytes = MAX_BYTES, maxFiles = MAX_FILES } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_BYTES || !Number.isSafeInteger(maxFiles) || maxFiles < 0 || maxFiles > MAX_FILES) fail('invalid_arguments', 'Disk image bounds must be integers within 768 KiB and 1024 files.');
  if (bytes instanceof ArrayBuffer) bytes = new Uint8Array(bytes);
  if (!(bytes instanceof Uint8Array)) fail('invalid_arguments', 'Expected Uint8Array disk image bytes.');
  if (bytes.length > maxBytes) limit('Disk image exceeds the byte limit.');
  if (bytes.length >= 512 && ascii(bytes, bytes.length - 512, 4) === 'koly') fail('unsupported_format', 'UDIF/DMG disk images are unsupported.');
  for (let sector = 16; sector < 80 && (sector + 1) * BLOCK <= bytes.length; sector++) {
    const at = sector * BLOCK, signature = ascii(bytes, at + 1, 5);
    if (['BEA01', 'NSR02', 'NSR03', 'TEA01'].includes(signature) && (sector === 16 || bytes[at] === 0 && bytes[at + 6] === 1)) fail('unsupported_format', 'UDF disk images are unsupported.');
    if (signature !== 'CD001' || bytes[at + 6] !== 1) break;
  }
  if (bytes.length >= 512 && ascii(bytes, bytes.length - 512, 8) === 'conectix') {
    const at = bytes.length - 512, view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length % 512 || view.getUint32(at + 8) !== 2 || view.getUint32(at + 12) !== 0x10000) invalid('Invalid VHD footer alignment/features/version.');
    let sum = 0; for (let i = at; i < at + 512; i++) if (i < at + 64 || i >= at + 68) sum += bytes[i];
    if (view.getUint32(at + 64) !== ((~sum) >>> 0)) invalid('VHD footer checksum mismatch.');
    if (view.getUint32(at + 60) !== 2) fail('unsupported_format', 'Only fixed VHD disk images are supported.');
    if (view.getBigUint64(at + 16) !== 0xffffffffffffffffn) invalid('Fixed VHD requires the all-ones data offset.');
    const original = view.getBigUint64(at + 40), current = view.getBigUint64(at + 48);
    if (current !== BigInt(at) || !original || original % 512n || bytes[at + 84] > 1 || bytes.subarray(at + 85).some(byte => byte !== 0)) invalid('VHD footer capacity/reserved fields disagree with the actual disk.');
    if (!bytes[at + 58] || bytes[at + 58] > 16 || !bytes[at + 59]) invalid('Invalid VHD disk geometry.');
    const payload = bytes.subarray(0, at);
    if (payload.length < 18 * BLOCK || ascii(payload, 16 * BLOCK + 1, 5) !== 'CD001') fail('unsupported_filesystem', 'Fixed VHD is valid, but its filesystem is unsupported; this local reader supports ISO9660 payloads, not FAT/NTFS.');
    const image = parseISO(payload, { maxBytes, maxFiles });
    return { ...image, format: 'vhd', capacityBytes: at };
  }
  if (bytes.length < 18 * BLOCK || ascii(bytes, 16 * BLOCK + 1, 5) !== 'CD001') fail('unsupported_format', 'Expected genuine ISO9660 or fixed VHD bytes; UDF and UDIF/DMG are unsupported.');
  if (bytes.length % BLOCK) invalid('ISO image must end on a complete logical block; invalid or truncated VHD footer.');
  const image = parseISO(bytes, { maxBytes, maxFiles });
  if (bytes.subarray(image.capacityBytes).some(byte => byte !== 0)) invalid('Nonzero data after the ISO volume; invalid VHD footer or unknown image trailer.');
  return image;
}
