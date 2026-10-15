// These are fictional browser-local packages, not Apple/Microsoft listings or host installers.
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
export const STORE_PACKAGES = freeze([
  {
    id: 'trail-calculator', installedId: 'local-calculator', name: 'Trail Calculator', subtitle: 'A little room for big numbers', developer: 'Harbor Workshop · fictional', icon: 'calculator', category: 'Utilities', categories: ['Utilities', 'Productivity', 'Education'], sections: ['discover', 'featured', 'create', 'work', 'play', 'apps', 'home'],
    description: 'Work out a trail budget, scale a drawing, or keep score. This fictional package opens the real, working local Calculator controller. Its starter release opens Basic mode; the authored 1.1 update opens Scientific mode. Nothing is downloaded from the internet or installed on your computer.',
    initialVersion: '1.0.0', latestVersion: '1.1.0', age: '4+', size: 'Bundled local runtime', language: 'English', privacy: 'No network, tracking, payments, or host access. Numbers stay in this scene.',
    releases: [
      { version: '1.0.0', mode: 'basic', notes: 'Starter release: real local arithmetic, percent, memory, and tape.', label: 'Basic arithmetic' },
      { version: '1.1.0', mode: 'scientific', notes: 'Scientific launch mode: use the actual Calculator scientific functions. Existing open calculator windows and their work are not changed.', label: 'Scientific launch mode' },
    ],
    screenshots: [{ id: 'trail-basic', title: 'Plan a small adventure', mode: 'basic', expression: '125 + 37', result: '162', caption: 'Authored local preview · Basic Calculator · 125 + 37 = 162' }, { id: 'trail-scientific', title: 'Make room for science', mode: 'scientific', expression: '9 × 9', result: '81', caption: 'Authored local preview · Scientific launch mode in release 1.1 · 9 × 9 = 81' }],
  },
  {
    id: 'radix-lab', installedId: 'local-radix-lab', name: 'Radix Lab', subtitle: 'Bits, bytes, and a clearer view', developer: 'Harbor Workshop · fictional', icon: 'calculator', category: 'Developer Tools', categories: ['Developer Tools', 'Utilities', 'Education'], sections: ['discover', 'featured', 'develop', 'apps', 'home'],
    description: 'A fictional local package for exploring number bases. Installing Radix Lab registers a distinct, launchable application entry that opens the real Calculator in Programmer mode. This is a local launch configuration, not an independently downloaded binary, and it never accesses host software.',
    initialVersion: '1.0.0', latestVersion: '1.0.0', age: '4+', size: 'Bundled local runtime', language: 'English', privacy: 'No network or host access. Base conversions run in the actual local Calculator.',
    releases: [{ version: '1.0.0', mode: 'programmer', notes: 'Programmer launch mode with actual local number-base and bitwise operations.', label: 'Programmer launch mode' }],
    screenshots: [{ id: 'radix-hex', title: 'A different way to see 255', mode: 'programmer', expression: '255 decimal', result: 'FF', caption: 'Authored local preview · Programmer Calculator · 255 decimal = FF hexadecimal' }, { id: 'radix-bits', title: 'Every bit in its place', mode: 'programmer', expression: '15 decimal', result: 'F', caption: 'Authored local preview · Programmer Calculator · 15 decimal = F hexadecimal' }],
  },
]);
export const STORE_CATEGORIES = freeze([
  ['Business', '▣'], ['Developer Tools', '⚒'], ['Education', '◇'], ['Entertainment', '◉'], ['Finance', '▰'], ['Games', '♜'], ['Graphics & Design', '◈'], ['Health & Fitness', '⌁'], ['Lifestyle', '⚑'], ['Medical', '♡'], ['Music', '♫'], ['News', '▤'], ['Photo & Video', '▣'], ['Productivity', '➤'], ['Reference', '❞'], ['Safari Extensions', '◌'], ['Social Networking', '♧'], ['Sports', '◴'], ['Travel', '✈'], ['Utilities', '▦'], ['Weather', '☀'],
]);
export const STORE_STORIES = freeze([
  { id: 'small-adventures', section: 'discover', eyebrow: 'FROM THE LOCAL EDITORS', title: 'A little room for big numbers', summary: 'Plan the weekend, one calculation at a time.', body: 'A good tool does one thing well. Add the cost of a campsite to your travel budget, divide a dinner bill, or calculate how much paint a small project needs. Trail Calculator is an authored fictional listing for the actual local Calculator. Installing it adds a real launch entry to this scene. The starter release opens Basic mode; its update opens Scientific mode. No account service, payment, or internet connection is involved.', packageId: 'trail-calculator', color: 'sand' },
  { id: 'create-scale', section: 'create', eyebrow: 'GET STARTED', title: 'Start with the right proportions', summary: 'A practical companion for your next drawing.', body: 'Double the dimensions of a sketch or scale a recipe without leaving your desktop. The local Calculator handles real arithmetic. The store does not claim that a calculator is a photo editor: this collection is a small, truthful guide to the bundled fictional packages available here.', packageId: 'trail-calculator', color: 'coral' },
  { id: 'work-budget', section: 'work', eyebrow: 'WORK SMARTER', title: 'Make the numbers add up', summary: 'A clear desk. A clear calculation.', body: 'Use Basic mode for totals, percentages, and quick estimates. Your calculations belong to the Calculator family, not a store mock-up. Opening an installed entry creates a real calculator window using its actual Root window ID.', packageId: 'trail-calculator', color: 'blue' },
  { id: 'play-score', section: 'play', eyebrow: 'JUST FOR FUN', title: 'Keep a friendly score', summary: 'Numbers for your next tabletop night.', body: 'Add points and divide a shared snack bill with the actual local Calculator. There are no authored game packages in this small local catalog; this is a calculator collection, not a simulated game download or subscription service.', packageId: 'trail-calculator', color: 'green' },
  { id: 'develop-bases', section: 'develop', eyebrow: 'DEVELOPER TOOLS', title: 'Think in another base', summary: 'The same number, a different perspective.', body: 'Radix Lab opens the actual local Calculator in Programmer mode. Compare hexadecimal, decimal, and binary representations using the working controller. Its local installation is a distinct registry entry and a launch configuration for a bundled runtime, never a host executable.', packageId: 'radix-lab', color: 'ink' },
]);
export const STORE_SEED_REVIEWS = freeze([
  { id: 'store-review-seed-trail', packageId: 'trail-calculator', authorId: 'fictional-mira', author: 'Mira · fictional reviewer', rating: 5, title: 'Small and useful', body: 'I used the local arithmetic for our fictional weekend budget. A clear calculator without an online account.', authoredAt: 1506816000000, revision: 0 },
  { id: 'store-review-seed-radix', packageId: 'radix-lab', authorId: 'fictional-rowan', author: 'Rowan · fictional reviewer', rating: 4, title: 'A useful change of perspective', body: 'Programmer mode makes it easier to compare number bases. This is a local package configuration, not a real Store download.', authoredAt: 1506902400000, revision: 0 },
]);
export const storePackage = id => STORE_PACKAGES.find(row => row.id === id) ?? null;
export const storeRelease = (packageId, version) => storePackage(packageId)?.releases.find(row => row.version === version) ?? null;

