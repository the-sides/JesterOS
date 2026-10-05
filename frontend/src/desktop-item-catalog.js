import { defineCommand, text, identity, number, offset, object, empty } from './command-schema.js';

export function desktopItemContracts(profiles, prefix, statePath, filesPath, capability) {
  const fileIds = { type: 'array', items: identity, uniqueItems: true };
  const rectangle = object({ x: number, y: number, width: offset, height: offset });
  const positions = { type: 'array', minItems: 1, items: object({ fileId: identity, x: number, y: number }) };
  const available = ['Live visible desktop items, no native global modal.'];
  const selection = [`${statePath}.selectedFileIds`, `${statePath}.selectionAnchorId`];
  const fileResult = object({ fileId: identity }), selectionResult = object({ fileIds });
  const nullableFile = object({ fileId: { anyOf: [identity, { type: 'null' }] } });
  const marquee = { anyOf: [object({ rectangle: { type: 'null', const: null } }), object({ rectangle, baseFileIds: fileIds }, ['rectangle'])] };
  const command = (name, target, payload, presentation, data, requires = available, resultTarget = fileResult) => defineCommand(profiles, `${prefix}.${name}`, capability, target, payload, requires, presentation, data, [], resultTarget);
  return [
    command('select', nullableFile, empty, ['Select exact item and activate desktop; null clears without changing active app.'], selection, available, nullableFile),
    command('select.range', object({ from: identity, to: identity }), empty, ['Select live ordered range and retain its anchor.'], selection, available, selectionResult),
    command('select.toggle', object({ fileId: identity }), empty, ['Toggle item in additive selection.'], selection, available, selectionResult),
    command('select.all', empty, empty, ['Select every live native desktop item.'], selection, available, selectionResult),
    command('marquee', empty, marquee, ['Show bounded physical workspace marquee and select intersecting item bounds; null clears rectangle without changing selection.'], [...selection, `${statePath}.marquee`], available, selectionResult),
    command('position', empty, object({ positions }), ['Atomically reposition the batch at desired physical workspace top-left coordinates; clamp to bounds and retain native layout offsets.'], [`${statePath}.positions`], available, selectionResult),
    command('rename.begin', object({ fileId: identity }), empty, ['Begin inline draft; focus editor and select name stem.'], [...selection, `${statePath}.rename`], [...available, 'Item permits native rename.']),
    command('rename.change', empty, object({ name: text }), ['Edit draft only; no filesystem mutation.'], [`${statePath}.rename`], [...available, 'A live rename draft is open.']),
    command('rename.commit', empty, empty, ['Commit real rename; preserve draft and show native validation on rejection.'], [filesPath, `${statePath}.rename`], [...available, 'An open draft has a valid unique native name.']),
    command('rename.cancel', empty, empty, ['Discard draft and restore exact item focus.'], [`${statePath}.rename`], [...available, 'A live rename draft is open.']),
    command('rename', object({ fileId: identity }), object({ name: text }), ['Apply real rename and close matching draft; never rename only a display label.'], [filesPath, `${statePath}.rename`], [...available, 'Item permits rename; valid unique native name.']),
    command('move', object({ fileIds: { ...fileIds, minItems: 1 }, folderId: identity }), empty, ['Atomically move real records to a simulated folder; no partial mutation on protected/cycle/collision rejection.'], [filesPath, ...selection, `${statePath}.positions`], [...available, 'Movable current desktop items and a valid collision-free destination.'], object({ fileIds, folderId: identity })),
  ];
}
