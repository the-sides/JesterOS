import { mojaveAdapter } from './mojave-adapter.js';
import { highSierraAdapter } from './high-sierra-adapter.js';
import { sonomaAdapter } from './sonoma-adapter.js';
import { windows11Adapter } from './windows11-adapter.js';

const adapters = new Map([
  ['mojave', mojaveAdapter],
  ['high-sierra', highSierraAdapter],
  ['sonoma', sonomaAdapter],
  ['windows11', windows11Adapter],
]);

// Every renderer supplies native views, scene data, document preparation and bounds policy.
export function getProfileAdapter(renderer) {
  const adapter = adapters.get(renderer);
  if (!adapter) throw new Error(`Unsupported OS renderer: ${String(renderer)}`);
  return adapter;
}
