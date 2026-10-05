import { defineCommand, identity, text, flag, offset, choice, object, empty } from './command-schema.js';
import { DESKTOP_SORTS } from './desktop-context-model.js';

export function desktopContextContracts(profiles, prefix, statePath, filesPath, capability, family = 'macos') {
  const fileIds = { type: 'array', minItems: 1, uniqueItems: true, items: identity };
  const fileTarget = object({ fileId: identity });
  const nullableId = { anyOf: [identity, { type: 'null', const: null }] };
  const menuId = choice('desktop-context');
  const available = ['Mounted native desktop; no global modal. Item actions require live visible entries.'];
  const contextState = [`${statePath}.context`, `${statePath}.selectedFileIds`, `${statePath}.selectionAnchorId`];
  const command = (name, target, payload, presentation, data, result, requires = available) => defineCommand(
    profiles, `${prefix}.${name}`, capability, target, payload, requires, presentation, data, [], result);
  const option = (name, value) => object({ option: choice(name), value });
  const viewPayload = { anyOf: family === 'windows' ? [
    option('iconSize', choice(32, 44, 64)),
    ...['alignToGrid', 'autoArrange', 'showIcons'].map(name => option(name, flag)),
  ] : [
    option('iconSize', { type: 'integer', minimum: 16, maximum: 128 }),
    option('gridSpacing', { type: 'integer', minimum: 8, maximum: 64 }),
    option('textSize', { type: 'integer', minimum: 10, maximum: 16 }),
    option('labelPosition', choice('bottom', 'right')),
    ...['showItemInfo', 'showIconPreview'].map(name => option(name, flag)),
  ] };
  const contracts = [
    command('context.open', object({ fileId: nullableId }), object({ x: offset, y: offset }),
      ['Open native target-dependent context tree at viewport client coordinates; clamp measured panel to actual workspace.', 'Focus first enabled native item.'],
      contextState, object({ menuId, fileId: nullableId })),
    command('context.close', empty, object({ restoreFocus: flag }, []),
      ['Close context tree; restore exact live file/workspace focus unless false.'], contextState, object({ menuId })),
    command('context.select', object({ itemId: identity }), object({ openSubmenu: flag }, []),
      ['Select/focus an enabled native tree entry and publish submenuId. Optional false collapses a parent branch; selecting a child always opens its parent.'], contextState,
      object({ menuId, itemId: identity }), [...available, 'Current context menu and enabled live tree item.']),
    command('context.execute', object({ itemId: identity }), empty,
      ['Invoke exact shared native leaf command and close on success; no pixel clicks or duplicate data reducer.'], [filesPath, ...contextState],
      object({ itemId: identity, fileId: nullableId }), [...available, 'Current context menu and enabled leaf action.']),
    command('folder.create', family === 'windows' ? empty : object({ fileIds }, []), object({ name: text }, []),
      ['Create real uniquely named desktop folder; missing name chooses native default and opens inline rename when visible.', 'Mac selected grouping validates complete source batch before allocation/movement.'],
      [filesPath, `${statePath}.rename`, ...contextState], fileTarget),
    command('trash', object({ fileIds }), empty,
      ['Validate complete movable live desktop selection before actual soft deletion; descendants follow parent visibility.', 'Prune removed selection/draft/placement.'],
      [filesPath, ...contextState, `${statePath}.rename`, `${statePath}.positions`], object({ fileIds })),
    command('sort', empty, object({ by: choice(...DESKTOP_SORTS) }),
      ['Set actual native ordering and clear manual positions; None restores record order.'],
      [`${statePath}.sortBy`, `${statePath}.positions`], object({ by: choice(...DESKTOP_SORTS) })),
    command('cleanup', object({ fileIds }, []), object({ by: choice('name', 'kind', 'size') }, []),
      ['One-shot bounded grid plan; all sources and free slots validate before placement. Selected-only cleanup reserves unselected occupied slots.', 'Optional by orders this cleanup without enabling persistent sort.'],
      [`${statePath}.positions`], object({ fileIds }), [...available, 'Visible items and enough real workspace grid; Mac Sort By is None.']),
    command('view.set', empty, viewPayload,
      ['Change actual native icon/grid/text/info/preview or Windows arrangement/visibility option; preserve true file authority.', 'Native auto-arrange resets manual placement; alignment snaps actual bounded slots.'],
      [`${statePath}.viewOptions`, `${statePath}.positions`], object({ option: identity })),
  ];
  if (family === 'windows') contracts.push(command('properties', fileTarget, empty,
    ['Open global native Properties using current real metadata; block underlying presentation until native close.'],
    [`${statePath}.dialog`, ...contextState], fileTarget));
  else contracts.push(
    command('info.open', fileTarget, empty, ['Open/raise one managed Finder Get Info utility for this real record; native window lifecycle and independent live metadata.'],
      ['windows', ...contextState], object({ fileId: identity, windowId: identity })),
    command('view.open', empty, empty, ['Open/raise the managed native Desktop view-options inspector; real controls use view.set/sort.'],
      ['windows', ...contextState], object({ windowId: identity })),
  );
  return contracts;
}
