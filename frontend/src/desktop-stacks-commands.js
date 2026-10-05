import { isRecord, rejected } from './feature-commands.js';
import { STACK_GROUPS, STACK_SORTS } from './desktop-stacks-model.js';

const fields = (value, names) => isRecord(value) && Object.keys(value).length === names.length
  && names.every(name => Object.hasOwn(value, name));
const id = value => typeof value === 'string' && value.length > 0;
const applied = target => ({ status: 'applied', target });
const invalid = () => rejected('invalid_arguments', 'Use the documented closed desktop Stacks arguments.');

export function createDesktopStacksCommands(state, context) {
  const available = () => context.available() && context.getView()?.itemsAvailable();
  const unavailable = () => rejected('unavailable', 'The desktop Stacks surface is hidden or blocked.');
  const enabled = () => state.stacks.enabled;
  const disabled = () => rejected('disabled', 'Turn on Use Stacks first.');
  const group = stackId => context.getGroups().find(group => group.id === stackId);
  const missing = () => rejected('not_found', 'This desktop stack no longer exists.');
  const clearFocus = () => {
    state.context = null;
    state.rename = null;
    state.selectedFileIds = [];
    state.selectionAnchorId = null;
    state.stacks.focusedStackId = null;
  };
  return {
    'desktop.stacks.set': async (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['enabled']) || typeof payload.enabled !== 'boolean') return invalid();
      if (!available()) return unavailable();
      if (enabled() !== payload.enabled) {
        context.focusDesktop();
        clearFocus();
        state.stacks.enabled = payload.enabled;
        state.stacks.expandedStackIds = [];
        state.stacks.topFileIds = {};
        await context.getView().focusContextReturn(null);
      }
      return applied({ enabled: enabled() });
    },
    'desktop.stacks.group': async (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['by']) || !STACK_GROUPS.includes(payload.by)) return invalid();
      if (!available()) return unavailable();
      if (!enabled()) return disabled();
      if (state.stacks.groupBy !== payload.by) {
        const restoreFocus = state.stacks.focusedStackId !== null || state.context !== null;
        clearFocus();
        state.stacks.groupBy = payload.by;
        state.stacks.expandedStackIds = [];
        state.stacks.topFileIds = {};
        if (restoreFocus) await context.getView().focusContextReturn(null);
      }
      return applied({ by: state.stacks.groupBy });
    },
    'desktop.stacks.sort': (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['by']) || !STACK_SORTS.includes(payload.by)) return invalid();
      if (!available()) return unavailable();
      if (!enabled()) return disabled();
      state.stacks.sortBy = payload.by;
      return applied({ by: state.stacks.sortBy });
    },
    'desktop.stacks.expand': async (target, payload) => {
      if (!fields(target, ['stackId']) || !id(target.stackId) || !fields(payload, ['expanded']) || typeof payload.expanded !== 'boolean') return invalid();
      if (!available()) return unavailable();
      if (!enabled()) return disabled();
      if (!group(target.stackId)) return missing();
      context.focusDesktop();
      clearFocus();
      state.stacks.expandedStackIds = payload.expanded
        ? [...new Set([...state.stacks.expandedStackIds, target.stackId])]
        : state.stacks.expandedStackIds.filter(id => id !== target.stackId);
      state.stacks.focusedStackId = target.stackId;
      await context.getView().focusStack(target.stackId);
      return applied({ stackId: target.stackId, expanded: payload.expanded });
    },
    'desktop.stacks.browse': async (target, payload) => {
      if (!fields(target, ['stackId']) || !id(target.stackId) || !fields(payload, ['direction']) || !['previous', 'next'].includes(payload.direction)) return invalid();
      if (!available()) return unavailable();
      if (!enabled()) return disabled();
      const stack = group(target.stackId);
      if (!stack) return missing();
      if (stack.expanded) return rejected('disabled', 'Collapse the stack before browsing its cover.');
      context.focusDesktop();
      state.stacks.focusedStackId = stack.id;
      const index = (stack.topIndex + (payload.direction === 'next' ? 1 : stack.fileIds.length - 1)) % stack.fileIds.length;
      const fileId = stack.fileIds[index];
      state.stacks.topFileIds[stack.id] = fileId;
      await context.getView().focusStack(stack.id);
      return applied({ stackId: stack.id, fileId, index });
    },
    'desktop.stacks.open': async (target, payload) => {
      if (!fields(target, ['stackId']) || !id(target.stackId) || !fields(payload, [])) return invalid();
      if (!available()) return unavailable();
      if (!enabled()) return disabled();
      const stack = group(target.stackId);
      if (!stack) return missing();
      const result = await context.invoke('desktop.open', { fileId: stack.topFileId }, {});
      return result.status === 'applied' ? applied({ stackId: stack.id, fileId: stack.topFileId,
        appId: result.target.appId, windowId: result.target.windowId }) : result;
    },
    'desktop.stacks.focus': async (target, payload) => {
      if (!fields(target, ['stackId']) || !id(target.stackId) || !fields(payload, [])) return invalid();
      if (!available()) return unavailable();
      if (!enabled()) return disabled();
      if (!group(target.stackId)) return missing();
      context.focusDesktop();
      state.stacks.focusedStackId = target.stackId;
      await context.getView().focusStack(target.stackId);
      return applied({ stackId: target.stackId });
    },
    'desktop.stacks.context': async (target, payload) => {
      if (!fields(target, ['stackId']) || !id(target.stackId) || !fields(payload, ['x', 'y'])
        || ![payload.x, payload.y].every(value => Number.isFinite(value) && value >= 0)) return invalid();
      if (!available()) return unavailable();
      if (!enabled()) return disabled();
      const stack = group(target.stackId);
      if (!stack) return missing();
      state.selectedFileIds = [...stack.fileIds];
      state.selectionAnchorId = stack.topFileId;
      state.stacks.focusedStackId = stack.id;
      const result = await context.invoke('desktop.context.open', { fileId: stack.topFileId }, payload);
      if (result.status === 'applied') state.stacks.focusedStackId = stack.id;
      return result.status === 'applied' ? applied({ stackId: stack.id, fileId: stack.topFileId, menuId: 'desktop-context' }) : result;
    },
  };
}
