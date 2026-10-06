// Original documentation for this simulation, not documentation for a host Mac.
const article = (articleId, title, summary, ...sections) => ({ articleId, title, summary,
  sections: sections.map(([heading, ...paragraphs]) => ({ heading, paragraphs })) });

export function helpArticles(profile, appId) {
  const app = profile?.applications?.[appId];
  if (!app || profile.id !== 'macos-golden-gate-27.0.1') return [];
  const articles = [article('overview', `${app.name} in this simulation`, 'Understand what this local application represents.',
    ['Scope', app.coverage === 'launch-only'
      ? `${app.name} has a launchable application window and shell controls. Its application interior is not represented: launching it does not browse websites, open a terminal, contact a service, or perform the real application's work.`
      : `${app.name} represents local ${app.coverage ?? 'application'} behavior. These instructions describe the simulation, not your computer's applications.`,
    'The desktop is fictional and offline. No cloud account, network service, host system setting, or physical device is controlled by these windows.'],
    ['Finding help', 'Help search belongs to the frontmost application. Menu command results include disabled and nested commands; their location identifies the menu path. Help Topics opens these original offline articles.',
    'Search words are matched literally, ignoring case. All words must occur in an article. Contents shows the full article list; Back and Forward return to previously read articles.']),
  article('windows', `Manage ${app.name} windows`, 'Move, resize, minimize, and return to application windows.',
    ['Window controls', 'Drag a window title bar to move it. Use its resize edges when available. The red control closes the window; the yellow control minimizes it. Closing a window is different from quitting an application.',
    'Use the Window menu or the Dock to return to a window. The green control and its menu provide represented zoom, full-screen, and split-view choices when enabled. Disabled choices cannot be performed.'],
    ['Window count', app.multipleWindows
      ? 'This application supports multiple ordinary windows. New Window creates another simulation window; it does not create a real document or an unrepresented application interior.'
      : 'This application uses one ordinary window. Launching it again returns to that window rather than creating a second ordinary window.']),
  article('lifecycle', `Open, hide, and ${app.quitAllowed === false ? 'return to' : 'quit'} ${app.name}`, 'Use the local application lifecycle and Dock.',
    ['Opening and hiding', 'Launch the application from the Dock or the represented application inventory. Selecting an open window makes its application frontmost. Hide removes its windows from view without closing them; Show returns them.'],
    ['Quitting', app.quitAllowed === false
      ? 'This application cannot be quit in the simulation. You can still manage its windows and switch to another application.'
      : 'Quit closes this application’s simulation windows. Launch it again to return. This does not quit a host computer application.'])];
  if (appId === 'notes') articles.push(
    article('notes-editing', 'Write and find plain-text notes', 'Create, select, edit, search, and organize local notes.',
      ['Writing', 'Select a note to read or edit its plain-text title and body. New Note adds a local note. Text editing, selection, undo, and redo operate on represented note text, not rich-text attachments or cloud documents.'],
      ['Finding and organizing', 'Use the search field to filter notes. Pinning keeps a note near the top. Deleting sends it to Recently Deleted, where Restore returns the note. Permanent deletion confirmations and retention rules are not represented. There is no iCloud synchronization.']),
    article('notes-view', 'Choose a Notes view', 'Use list or gallery, zoom, and Notes preferences.',
      ['Presentation', 'The View menu changes list or gallery presentation. Opening a gallery note shows its document; returning shows the gallery again. Zoom changes the represented note presentation.'],
      ['Preferences', 'Notes Settings provides sort order, grouping by date, and default text size. Pinned notes remain at the top. Recently Deleted uses its default sort.']),
    article('notes-files', 'Export and print a note', 'Save real virtual PDF or Markdown output and use the fictional Print Center.',
      ['Export', 'Select a readable note, then choose File > Export To > PDF or Markdown. The owned Save pane accepts a name, folder, and tags. An existing name requires explicit replacement. Output stays in the virtual filesystem; no host download or picker is opened.'],
      ['Print', 'File > Print shows actual note pages. Choose a page range and copies for the fictional Studio Printer, or Save as PDF. Print Center shows the immutable queued output and supports pause, resume, cancellation, and completed job history. It never sends data to a physical printer.']));
  if (appId === 'finder') articles.push(
    article('finder-locations', 'Browse local Finder locations', 'Navigate represented folders and inspect local items.',
      ['Locations', 'Use the Finder sidebar and folder items to browse represented desktop locations. These are simulation records, not access to your host filesystem. Opening an application item launches its simulation application.'],
      ['Presentation', 'Finder View choices change icons, list, columns, or gallery presentation where enabled. View Options changes represented sorting, grouping, icon spacing, and text size for the owned folder. Toolbar and sidebar visibility are local window presentation choices.']),
    article('finder-files', 'Work with represented files', 'Use supported file commands without changing host files.',
      ['Local records', 'Create folders and use enabled rename, duplicate, move, and Trash actions on writable simulation items. Installed read-only items cannot be edited. File dialogs operate on represented records; they do not grant host filesystem access.']));
  if (appId === 'settings') articles.push(
    article('dock-preferences', 'Adjust the simulated Dock', 'Change represented Dock preferences, not host settings.',
      ['Dock preferences', 'Use the represented Dock controls to change size, magnification, auto-hide, minimize-into-app, and recent-app presentation. These preferences apply to the fictional desktop only.']),
    article('appearance', 'Choose fictional appearance and colors', 'Set the local light or dark palette, accent, and highlight.',
      ['Appearance', 'Open the represented Appearance pane to choose Light or Dark, an available accent, and a preset or custom RGB/Hex highlight. About, fictional display/storage summaries and coverage are separate represented pages; other unimplemented settings do not configure your computer.']),
    article('mac-getting-started', 'Get started with the fictional MacBook Air', 'Identify the scene machine and use its represented desktop.',
      ['Identify your Mac', 'Apple menu > About This Mac shows the invented MacBook Air/M2 identity and installed Golden Gate version. More Info opens System Settings > General > About; click its version to reveal the fictional build. System Report opens the matching read-only local hardware/software summary.'],
      ['Use the scene', 'Open Notes from the Dock to write local plain-text notes. Finder browses the virtual disk; its supported file actions never access host files. The About Name field changes only this retained fictional scene’s computer name.'],
      ['Keep data local', 'Local logout retains the exact desktop for a later fictional login using scene. Guest logout discards only Guest. Explicit browser-local Save/Restore is operator setup; a normal reload never automatically restores a saved desktop.']),
    article('mac-support', 'Get support for this fictional Mac', 'Read real local guidance without a support account or network request.',
      ['Identify the scene', 'Open General > About to read the model, chip, memory, serial and version. These values are invented scene fixtures, not diagnostic information about the host. Details displays fictional repairs/service and technical-support coverage using the scene clock.'],
      ['Resolve represented issues', 'If a local app is hidden or minimized, return through its Dock icon or Window menu. Force Quit removes its local windows while preserving supported Notes/document/Services records under the disclosed recovery policy. Finder Relaunch creates a fresh ordinary Finder window without deleting virtual files.'],
      ['Storage and documents', 'Storage shows actual writable virtual document/Trash payload sizes plus fictional reserved system/app allocation. Moving a document to Trash does not free its bytes until permanent deletion. Use implemented Finder restore/open actions for virtual records; no host disk is scanned.'],
      ['Support boundary', 'This original offline article does not contact Apple, submit diagnostics, collect credentials or place a call. Real Apple warranty and technical assistance require a separate real-world service outside this scene.']),
    article('mac-service', 'Review fictional service and repair options', 'Understand the scene coverage and prepare local machine information.',
      ['Review coverage', 'Open General > About > Details to read the fictional AppleCare plan, expiry, repairs/service and technical-support state. Coverage is based on the seeded scene date; it is not a real warranty or an online serial-number lookup.'],
      ['Prepare information', 'General > About provides model, chip, memory, fictional serial and exact installed version/build. System Report shows the same scene identity, display and currently running local apps. Do not provide a real password or Apple account.'],
      ['Service boundary', 'No physical inspection, hardware repair, appointment, shipping label, payment or remote support session occurs. The Service Options action opens this actual local article; it does not claim to book a service.']));
  if (appId === 'messages') articles.push(article('sample-conversations', 'Read the fixed sample conversation', 'Messages displays one fixed fictional conversation.',
    ['Sample content', 'The Trail Crew conversation is fixed scene content. Its conversation selection, search, new messages, and sending controls remain unavailable. Select its text to use Local Services; separate editable local drafts and fictional sent records do not change this sample or contact real people.']));
  if (['contacts', 'mail', 'messages'].includes(appId)) articles.push(article('local-services', 'Use local Services records', 'Create contacts or compose an addressed fictional message from a real selection.',
    ['Selection and composition', 'Select text in a represented Notes field, sample message, or local service record. Use the application menu’s Services submenu or the Local Services contextual popup. Create Contact preserves selected text in the contact’s Notes field and opens editable fields. New Email or New Message copies it into an editable draft; choosing a service never sends immediately.'],
    ['Local records', 'Done saves an identified contact. Send Locally creates a scene-only sent record; nothing is delivered over a network. A contact’s Mail and Message buttons create an addressed editable composition. Discard Draft removes only that draft. The lists show real saved local records, not sample inboxes or live accounts.'],
    ['Virtual attachments', 'Selected virtual documents can become immutable Mail attachment snapshots. Changing or deleting the original file does not change the stored snapshot. There is no host file picker, Mail Drop, cloud sync, or external delivery.']));
  return articles;
}

export function searchHelpArticles(profile, appId, query) {
  if (typeof query !== 'string' || query.length > 256) return [];
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return helpArticles(profile, appId).filter(value => {
    const text = [value.title, value.summary, ...value.sections.flatMap(section => [section.heading, ...section.paragraphs])].join('\n').toLowerCase();
    return words.every(word => text.includes(word));
  });
}
