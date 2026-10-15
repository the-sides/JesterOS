const studio = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400"><defs><linearGradient id="wall" x2="0" y2="1"><stop stop-color="#d4dee8"/><stop offset="1" stop-color="#91a4bb"/></linearGradient></defs><rect width="640" height="400" fill="url(#wall)"/><rect y="290" width="640" height="110" fill="#69747e"/><rect x="92" y="55" width="202" height="171" fill="#edf7ff"/><path d="M193 55v171M92 140h202" stroke="#56677b" stroke-width="8"/><rect x="334" y="242" width="205" height="20" rx="3" fill="#755749"/><path d="M348 262v84m172-84v84" stroke="#4a3530" stroke-width="12"/><rect x="382" y="188" width="76" height="53" rx="4" fill="#1b2a3e"/><rect x="389" y="194" width="62" height="39" fill="#65a7cf"/><path d="M420 241v8" stroke="#1b2a3e" stroke-width="6"/><circle cx="565" cy="227" r="29" fill="#46766b"/><path d="M548 245h35l-8 49h-20z" fill="#af7959"/></svg>';
const coast = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400"><defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="#74b7d8"/><stop offset="1" stop-color="#e5eced"/></linearGradient></defs><rect width="640" height="400" fill="url(#sky)"/><circle cx="500" cy="78" r="35" fill="#fff7d7"/><path d="M0 178h640v222H0z" fill="#367995"/><path d="M0 282Q145 226 267 312T640 323v77H0z" fill="#dbc7a0"/><path d="M0 283Q145 227 267 313T640 324" stroke="#eff5ec" stroke-width="17" fill="none"/><path d="M0 151l85-41 89 68-174 65z" fill="#627c76"/><path d="M374 210h104m-310 26h81m234 38h124" stroke="#82b3c4" stroke-width="4" stroke-linecap="round"/></svg>';
export function createWindows11FileStore() {
  const file = (id, parentId, name, kind, content = '') => ({ id, parentId, name, kind, content, deleted: false, revision: 1 });
  return { nextFileId: 1, files: [
    file('root', null, 'C:', 'folder'),
    file('desktop', 'root', 'Desktop', 'folder'),
    file('documents', 'root', 'Documents', 'folder'),
    file('pictures', 'root', 'Pictures', 'folder'),
    file('call-sheet', 'desktop', 'Call sheet.txt', 'text', 'CALL SHEET — TUESDAY, OCTOBER 31, 2023\n\nProduction: Northlight / Scene 06\nCrew call: 09:00\nLocation: Studio B\n\n09:41 — Desktop insert\n10:15 — Camera rehearsal\n11:00 — First take\n\nAll names and schedules in this scene are fictional.\n'),
    file('readme', 'documents', 'Welcome.txt', 'text', 'Welcome to this fictional Windows scene.\nFiles live only in this browser session.\nUse File Explorer, Notepad, Paint, Photos, Snipping Tool and Terminal with the same virtual folders.\n'),
    file('studio-photo', 'pictures', 'Studio.svg', 'image', studio),
    file('coast-photo', 'pictures', 'Coast.svg', 'image', coast),
  ] };
}
