import { mojaveAdapter } from './mojave-adapter.js';

const adapters = new Map([['mojave', mojaveAdapter]]);

// Every renderer supplies native views, scene data, document preparation and bounds policy.
export function getProfileAdapter(renderer) {
  const adapter = adapters.get(renderer);
  if (!adapter) throw new Error(`Unsupported OS renderer: ${String(renderer)}`);
  return adapter;
}
