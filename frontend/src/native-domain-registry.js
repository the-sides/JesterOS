import { copyCanonicalData } from './canonical-data.js';
import { createBrowserState, browserStateSchema, validateBrowserState, browserSessionSnapshot } from './browser-state.js';
import { browserCatalog, createBrowserCommands } from './browser-commands.js';
import { browserMenuProvider } from './browser-menus.js';
import { chromeMenuProvider, chromeGlobalMenuProvider, chromeWindowMetadata } from './chrome-family-adapter.js';
import { createTextEditState, validateTextEditState } from './textedit-state.js';
import { createTextEditController } from './textedit-commands.js';
import { TEXTEDIT_STATE_SCHEMA, textEditCommandCatalog, textEditNativeMenus, getTextEditProfile } from './textedit-catalog.js';
import { createPreviewState, previewStateSchema, validatePreviewState, previewWindowMetadata } from './preview-state.js';
import { createPreviewCommands, previewCatalog } from './preview-commands.js';
import { previewMenus } from './preview-menus.js';
import { createPhotosState, photosStateSchema, validatePhotosState, photosWindowMetadata } from './photos-state.js';
import { createPhotosCommands } from './photos-commands.js';
import { photosCatalog } from './photos-catalog.js';
import { photosMenus } from './photos-menus.js';
import { createMediaState, mediaStateSchema, validateMediaState, mediaNativeCapability } from './media-state.js';
import { createMediaCommands } from './media-commands.js';
import { mediaCatalog } from './media-catalog.js';
import { createMapsState, mapsSchema, validateMapsState, mapsCapabilities } from './maps-state.js';
import { createMapsCommands, mapsCatalog, mapsMenuProvider } from './maps-commands.js';
import { createFindMyState, findMySchema, validateFindMyState, findMyWindowMetadata, projectFindMyState, rehydrateFindMyState } from './findmy-state.js';
import { createFindMyCommands } from './findmy-commands.js';
import { findMyCatalog } from './findmy-catalog.js';
import { findMyMenus } from './findmy-menus.js';
import { createBooksState, booksSchema, validateBooksState, booksCapabilities } from './books-state.js';
import { createBooksCommands, booksCatalog, booksMenus } from './books-commands.js';
import { createCalculatorState, calculatorSchema, validateCalculatorState, calculatorWindowMetadata } from './calculator-state.js';
import { createCalculatorCommands } from './calculator-commands.js';
import { calculatorCatalog } from './calculator-catalog.js';
import { calculatorMenus } from './calculator-menus.js';
import { createDictionaryState, dictionarySchema, validateDictionaryState, dictionaryNativeCapability } from './dictionary-state.js';
import { createDictionaryCommands } from './dictionary-commands.js';
import { dictionaryCatalog } from './dictionary-catalog.js';
import { dictionaryMenus } from './dictionary-menus.js';
import { createStickiesState, stickiesSchema, validateStickiesState, stickiesCapabilities } from './stickies-state.js';
import { createStickiesCommands } from './stickies-commands.js';
import { stickiesCatalog } from './stickies-catalog.js';
import { stickiesMenus } from './stickies-menus.js';
import { createStocksState, stocksSchema, validateStocksState, stocksCapabilities } from './stocks-state.js';
import { createStocksCommands } from './stocks-commands.js';
import { stocksCatalog } from './stocks-catalog.js';
import { stocksMenus } from './stocks-menus.js';
import { createNewsState, newsSchema, validateNewsState } from './news-state.js';
import { createNewsCommands } from './news-commands.js';
import { newsCatalog, newsWindowMetadata } from './news-catalog.js';
import { newsMenus } from './news-menus.js';
import { createHomeState, homeSchema, validateHomeState, homeCapabilities } from './home-state.js';
import { createHomeCommands } from './home-commands.js';
import { homeCatalog } from './home-catalog.js';
import { homeMenus } from './home-menus.js';
import { createChessState, chessSchema, validateChessState, chessAvailability } from './chess-state.js';
import { createChessCommands } from './chess-commands.js';
import { chessCatalog } from './chess-catalog.js';
import { chessMenuItems } from './chess-menus.js';
import { createDVDState, dvdSchema, validateDVDState, dvdAvailability } from './dvd-state.js';
import { createDVDCommands } from './dvd-commands.js';
import { dvdCatalog, dvdMenuItems } from './dvd-catalog.js';
import { createStoreState, storeSchema, validateStoreState, storeWindowMetadata, storeInstalledDescriptors } from './store-state.js';
import { createStoreCommands } from './store-commands.js';
import { storeCatalog } from './store-catalog.js';
import { storeMenus } from './store-menus.js';
import { createPreferencesState, preferencesSchema, validatePreferencesState, preferencesSavedState, restorePreferencesState, preferencesSession } from './preferences-state.js';
import { createPreferencesCommands } from './preferences-commands.js';
import { preferencesCatalog, preferencesMenu } from './preferences-catalog.js';
import { createTerminalState, terminalSchema, validateTerminalState, terminalWindowMetadata } from './terminal-state.js';
import { createTerminalCommands } from './terminal-commands.js';
import { terminalCatalog } from './terminal-catalog.js';
import { terminalMenuItems } from './terminal-menus.js';
import { createScriptEditorState, scriptEditorSchema, validateScriptEditorState, scriptEditorForPersistence, rehydrateScriptEditorState } from './script-editor-state.js';
import { createScriptEditorCommands } from './script-editor-commands.js';
import { scriptEditorCatalog } from './script-editor-catalog.js';
import { scriptEditorMenuItems } from './script-editor-menus.js';
import { createAutomatorState, automatorSchema, validateAutomatorState, automatorWindowMetadata, projectAutomatorState, rehydrateAutomatorState } from './automator-state.js';
import { createAutomatorCommands } from './automator-commands.js';
import { automatorCatalog } from './automator-catalog.js';
import { automatorMenuItems } from './automator-menus.js';
import { createArchiveState, archiveSchema, validateArchiveState, archiveWindowMetadata } from './archive-state.js';
import { createArchiveCommands } from './archive-commands.js';
import { archiveCatalog } from './archive-catalog.js';
import { archiveMenuItems } from './archive-menus.js';
import { createActivityState, activitySchema, validateActivityState, activityAvailability } from './activity-state.js';
import { createActivityCommands } from './activity-commands.js';
import { activityCatalog } from './activity-catalog.js';
import { activityMenuItems } from './activity-menus.js';
import { createConsoleState, consoleSchema, validateConsoleState, consoleAvailability, consolePersistenceState, rehydrateConsoleState } from './console-state.js';
import { createConsoleCommands } from './console-commands.js';
import { consoleCatalog } from './console-catalog.js';
import { consoleMenus } from './console-menus.js';
import { createSystemInformationState, systemInformationSchema, validateSystemInformationState, systemInformationAvailability } from './system-information-state.js';
import { createSystemInformationCommands } from './system-information-commands.js';
import { systemInformationCatalog } from './system-information-catalog.js';
import { systemInformationMenuItems } from './system-information-menus.js';
import { createColorMeterState, colorMeterSchema, validateColorMeterState, colorMeterWindowMetadata, colorMeterCapabilities } from './color-meter-state.js';
import { createColorMeterCommands } from './color-meter-commands.js';
import { colorMeterCatalog } from './color-meter-catalog.js';
import { colorMeterMenus } from './color-meter-menus.js';
import { createColorSyncState, colorSyncSchema, validateColorSyncState, colorSyncWindowMetadata } from './colorsync-state.js';
import { createColorSyncCommands } from './colorsync-commands.js';
import { colorSyncCatalog } from './colorsync-catalog.js';
import { colorSyncMenus } from './colorsync-menus.js';
import { createGrapherState, grapherSchema, validateGrapherState, grapherWindowMetadata } from './grapher-state.js';
import { createGrapherCommands } from './grapher-commands.js';
import { grapherCatalog } from './grapher-catalog.js';
import { grapherMenus } from './grapher-menus.js';
import { createImageCaptureState, imageCaptureSchema, validateImageCaptureState, imageCaptureWindowMetadata } from './image-capture-state.js';
import { createImageCaptureCommands } from './image-capture-commands.js';
import { imageCaptureCatalog } from './image-capture-catalog.js';
import { imageCaptureMenus } from './image-capture-menus.js';
import { createBluetoothExchangeState, bluetoothExchangeSchema, validateBluetoothExchangeState, bluetoothExchangeWindowMetadata } from './bluetooth-exchange-state.js';
import { createBluetoothExchangeCommands } from './bluetooth-exchange-commands.js';
import { bluetoothExchangeCatalog } from './bluetooth-exchange-catalog.js';
import { bluetoothExchangeMenus } from './bluetooth-exchange-menus.js';
import { createKeychainState, keychainSchema, validateKeychainState, keychainWindowMetadata, keychainPersistenceProjection } from './keychain-state.js';
import { createKeychainCommands } from './keychain-commands.js';
import { keychainCatalog } from './keychain-catalog.js';
import { keychainMenus } from './keychain-menus.js';
import { createFontBookState, fontBookSchema, validateFontBookState, fontBookWindowMetadata, fontBookPersistenceProjection, createFontGraph, fontGraphSchema, validateFontGraph } from './font-book-state.js';
import { createFontBookCommands } from './font-book-commands.js';
import { fontBookCatalog } from './font-book-catalog.js';
import { fontBookMenus } from './font-book-menus.js';
import { createAudioMidiState, audioMidiSchema, validateAudioMidiState, audioMidiWindowMetadata, audioMidiSessionData, restoreAudioMidiState } from './audio-midi-state.js';
import { createAudioMidiCommands } from './audio-midi-commands.js';
import { audioMidiCatalog } from './audio-midi-catalog.js';
import { audioMidiMenus } from './audio-midi-menus.js';
import { createVoiceOverState, voiceOverSchema, validateVoiceOverState, voiceOverWindowMetadata, voiceOverSessionData, restoreVoiceOverState } from './voiceover-state.js';
import { createVoiceOverCommands } from './voiceover-commands.js';
import { voiceOverCatalog } from './voiceover-catalog.js';
import { voiceOverMenus } from './voiceover-menus.js';
import { createNetworkUtilityState, networkUtilitySchema, validateNetworkUtilityState, networkUtilityWindowMetadata, networkUtilityPersistentState, rehydrateNetworkUtilityState } from './network-utility-state.js';
import { createNetworkUtilityCommands } from './network-utility-commands.js';
import { networkUtilityCatalog } from './network-utility-catalog.js';
import { networkUtilityMenus } from './network-utility-menus.js';
import { createAirportState, airportSchema, validateAirportState, airportWindowMetadata, airportPersistentState, rehydrateAirportState } from './airport-state.js';
import { createAirportCommands } from './airport-commands.js';
import { airportCatalog } from './airport-catalog.js';
import { airportMenus } from './airport-menus.js';
import { createDiskState, diskSchema, validateDiskState } from './disk-state.js';
import { createDiskCommands } from './disk-commands.js';
import { createBackupState, backupSchema, validateBackupState } from './backup-state.js';
import { createBackupCommands } from './backup-commands.js';
import { createMigrationState, migrationSchema, validateMigrationState } from './migration-state.js';
import { createMigrationCommands } from './migration-commands.js';
import { createBootCampState, bootCampSchema, validateBootCampState } from './boot-camp-state.js';
import { createBootCampCommands } from './boot-camp-commands.js';
import { diskCatalog, backupCatalog, migrationCatalog, bootCampCatalog } from './disk-catalog.js';
import { diskMenuItems, migrationMenuItems, bootCampMenuItems, timeMachineMenuItems } from './disk-menus.js';
import { diskWindowMetadata } from './disk-window-metadata.js';
import { projectDiskState, rehydrateDiskState, projectBackupState, rehydrateBackupState, projectMigrationState, rehydrateMigrationState, projectBootCampState, rehydrateBootCampState } from './disk-persistence.js';
import { validateDiskFiles, validateBackupFiles } from './disk-file-validation.js';
import { createPagesState, pagesStateSchema, validatePagesState, pagesCatalog, pagesMenus, pagesWindowMetadata } from './pages-model.js';
import { createPagesCommands } from './pages-commands.js';
import { createNumbersState, numbersStateSchema, validateNumbersState, numbersWindowMetadata } from './numbers-state.js';
import { createNumbersCommands } from './numbers-commands.js';
import { numbersCatalog } from './numbers-catalog.js';
import { numbersMenus } from './numbers-menus.js';
import { createKeynoteState, keynoteStateSchema, validateKeynoteState, keynoteAvailability, keynoteWindowMetadata, keynotePersistenceState, rehydrateKeynoteState } from './keynote-state.js';
import { createKeynoteCommands } from './keynote-commands.js';
import { keynoteCatalog } from './keynote-catalog.js';
import { keynoteMenus } from './keynote-menus.js';
import { createWordState, wordSchema, validateWordState, wordWindowMetadata } from './word-state.js';
import { createWordCommands } from './word-commands.js';
import { wordCatalog } from './word-catalog.js';
import { wordMenus } from './word-menus.js';
import { createExcelState, excelSchema, validateExcelState, excelWindowMetadata } from './excel-state.js';
import { createExcelCommands } from './excel-commands.js';
import { excelCatalog } from './excel-catalog.js';
import { excelMenus } from './excel-menus.js';
import { createPowerPointState, powerpointSchema, validatePowerPointState, powerpointWindowMetadata } from './powerpoint-state.js';
import { createPowerPointCommands } from './powerpoint-commands.js';
import { powerpointCatalog } from './powerpoint-catalog.js';
import { powerpointMenus } from './powerpoint-menus.js';
import { createXcodeState, xcodeSchema, validateXcodeState, xcodeAvailability, xcodePersistenceProjection, rehydrateXcodeState } from './xcode-state.js';
import { createXcodeCommands } from './xcode-commands.js';
import { xcodeCatalog } from './xcode-catalog.js';
import { xcodeMenuItems, xcodeWindowMetadata } from './xcode-menus.js';
import { createClockAppState, clockAppSchema, validateClockAppState, clockAppMeta, migrateWindowsClockState } from './clock-app-state.js';
import { createClockAppCommands, clockAppCatalog, clockAppMenus } from './clock-app-commands.js';
import { weatherAppDefaults, weatherAppSchema, validateWeatherAppState, weatherAppMeta } from './weather-app-state.js';
import { createWeatherAppCommands, weatherAppCatalog, weatherAppMenus } from './weather-app-commands.js';
import { createShortcutsState, shortcutsSchema, validateShortcutsState, shortcutsWindowMetadata, projectShortcutsState, rehydrateShortcutsState } from './shortcuts-state.js';
import { createShortcutsCommands } from './shortcuts-commands.js';
import { shortcutsCatalog } from './shortcuts-catalog.js';
import { shortcutsMenus } from './shortcuts-menus.js';
import { createScreenshotState, screenshotSchema, validateScreenshotState, screenshotAppId, screenshotWindowMetadata, createMagnifierState, magnifierSchema, validateMagnifierState, magnifierWindowMetadata, captureToolCapabilities } from './capture-tools-state.js';
import { createScreenshotCommands, createMagnifierCommands } from './capture-tools-commands.js';
import { screenshotCatalog, magnifierCatalog } from './capture-tools-catalog.js';
import { screenshotMenus, magnifierMenus } from './capture-tools-menus.js';
import { createGamesState, gamesSchema, validateGamesState, gamesWindowMetadata, createTipsState, tipsSchema, validateTipsState, tipsWindowMetadata } from './games-tips-state.js';
import { createGamesCommands, createTipsCommands } from './games-tips-commands.js';
import { gamesCatalog, tipsCatalog } from './games-tips-catalog.js';
import { gamesMenus, tipsMenus } from './games-tips-menus.js';
import { createScreenSharingState, screenSharingSchema, validateScreenSharingState, screenSharingWindowMetadata, screenSharingPersistenceProjection, rehydrateScreenSharingState } from './screen-sharing-state.js';
import { createScreenSharingCommands } from './screen-sharing-commands.js';
import { screenSharingCatalog } from './screen-sharing-catalog.js';
import { screenSharingMenus } from './screen-sharing-menus.js';
import { createPhoneState, createMirroringState, phoneFamilySchema, validatePhoneState, phoneSavedState, restorePhoneState, phoneWindowMetadata, phoneAvailability } from './phone-family-state.js';
import { createPhoneCommands, createMirroringCommands, phoneCatalog, mirroringCatalog, phoneMenus, mirroringMenus } from './phone-family-commands.js';
import { createJournalState, journalSchema, validateJournalState, journalWindowMetadata, journalPersistenceState, rehydrateJournalState } from './journal-state.js';
import { createJournalCommands } from './journal-commands.js';
import { journalCatalog } from './journal-catalog.js';
import { journalMenus } from './journal-menus.js';
import { createFreeformState, freeformStateSchema, validateFreeformState, freeformWindowMetadata, freeformAvailability, freeformPersistenceState, rehydrateFreeformState } from './freeform-state.js';
import { createFreeformCommands } from './freeform-commands.js';
import { freeformCatalog } from './freeform-catalog.js';
import { freeformMenus } from './freeform-menus.js';
import { createImagePlaygroundState, imagePlaygroundStateSchema, validateImagePlaygroundState, imagePlaygroundWindowMetadata, imagePlaygroundPersistenceState, rehydrateImagePlaygroundState } from './image-playground-state.js';
import { createImagePlaygroundCommands } from './image-playground-commands.js';
import { imagePlaygroundCatalog } from './image-playground-catalog.js';
import { imagePlaygroundMenus } from './image-playground-menus.js';
import { createPasswordsState, passwordsSchema, validatePasswordsState, passwordsPersistentState, rehydratePasswordsState, createPasswordsCommands, passwordsCatalog, passwordsMenus, passwordsWindowMetadata, passwordsWindow, passwordsAuthorized } from './passwords-assistant.js';
import { createDirectoryUtilityState, directoryUtilitySchema, validateDirectoryUtilityState, directoryUtilityPersistentState, rehydrateDirectoryUtilityState, createDirectoryUtilityCommands, directoryUtilityCatalog, directoryUtilityMenus, directoryUtilityWindowMetadata, directoryUtilityWindow, directoryUtilityAuthorized } from './directory-utility.js';
import { createSiriAssistantState, siriAssistantSchema, validateSiriAssistantState, siriAssistantPersistentState, rehydrateSiriAssistantState, createSiriAssistantCommands, siriAssistantCatalog, siriAssistantMenus, siriAssistantWindowMetadata } from './siri-assistant.js';

export const NATIVE_PROFILE_IDS = Object.freeze(['macos-high-sierra-10.13', 'macos-mojave-10.14', 'macos-sonoma-14.0', 'macos-golden-gate-27.0.1', 'windows11-23h2-22631.2428']);
const windows = profile => profile.family === 'windows' || profile.id.startsWith('windows11');
const classic = profile => /high-sierra|mojave/u.test(profile.id);
const ids = (mac, win = mac) => profile => windows(profile) ? win : mac;
const bounds = (appId, title, width, height, minWidth, minHeight, extra = {}) => ({ appId, title, width, height, minWidth, minHeight, ...extra });
const windowsOf = state => state.windows;
const sessionsOf = state => state.sessions;
const none = () => [];
const result = value => typeof value === 'boolean' ? { ok: value, ...(value ? {} : { message: 'Invalid canonical native graph.' }) } : value;

// Components are exact static module names, resolved by Root's Svelte-only map.
// Importing UI here would make plain-JS profile/codec/session consumers depend on
// a Svelte loader. This table does not construct a second renderer or state graph.
export const nativeDomainDefinitions = {
  browser: {
    key: 'browser', appIds: ids(['safari', 'chrome'], ['edge', 'chrome']), utilityKinds: [],
    createState: createBrowserState, schema: browserStateSchema, validate: validateBrowserState,
    createCommands: ctx => createBrowserCommands(ctx), catalog: browserCatalog,
    component: 'BrowserApp.svelte', componentForWindow: (_, window) => window.appId === 'chrome' ? 'NativeChromeApp.svelte' : 'BrowserApp.svelte',
    menus: args => args.window?.appId === 'chrome' || args.state.windows.find(row => row.id === args.windowId)?.nativeAppId === 'chrome' ? (windows(args.profile) ? chromeMenuProvider(args) : chromeGlobalMenuProvider(args)) : browserMenuProvider(args),
    windowMetadata: (profile, options = {}) => options.appId === 'chrome' ? chromeWindowMetadata(profile) : bounds(windows(profile) ? 'edge' : 'safari', windows(profile) ? 'Microsoft Edge' : 'Safari', 1024, 720, 640, 400),
    sessions: state => state.windows.filter(row => !row.closed), sessionId: row => row.id,
    ownsWindow: (profile, window) => !window.utilityKind && (window.appId === 'chrome' || window.appId === (windows(profile) ? 'edge' : 'safari')),
    project: browserSessionSnapshot,
  },
  textedit: {
    key: 'textedit', appIds: ids(['textedit'], ['notepad', 'wordpad']), utilityKinds: ['textedit-document'],
    createState: createTextEditState, schema: TEXTEDIT_STATE_SCHEMA, validate: validateTextEditState,
    createCommands: ctx => createTextEditController(ctx), catalog: textEditCommandCatalog, component: 'TextEditApp.svelte',
    menus: args => { const session = args.state.windows.find(row => row.windowId === args.windowId), document = args.state.documents.find(row => row.id === session?.documentId); return nativeMenuRequests(textEditNativeMenus(args.profile, document?.content.kind ?? (args.window?.appId === 'notepad' ? 'plain' : 'rich'), { window: session, preferences: args.state.preferences, ...args.nativeContext }), args.windowId); },
    windowMetadata: (profile, options = {}) => { const native = getTextEditProfile(profile), rich = options.documentKind !== 'plain'; return { ...native.window, appId: options.appId ?? (rich ? native.richAppId : native.plainAppId), title: windows(profile) ? rich ? 'WordPad' : 'Notepad' : 'TextEdit', windowKind: native.windowKind, documentKind: rich ? 'rich' : 'plain' }; }, sessions: windowsOf,
  },
  preview: {
    key: 'preview', appIds: ids(['preview'], ['edge']), utilityKinds: ['edge-pdf'],
    createState: createPreviewState, schema: previewStateSchema, validate: validatePreviewState,
    createCommands: ctx => createPreviewCommands(ctx), catalog: previewCatalog, component: 'PreviewApp.svelte', menus: previewMenus,
    windowMetadata: (profile, options = {}) => previewWindowMetadata(profile, options.mime ?? 'application/pdf'), sessions: windowsOf,
    ownsWindow: (profile, window) => windows(profile) ? window.appId === 'edge' && window.utilityKind === 'edge-pdf' : window.appId === 'preview' && (!window.utilityKind || window.utilityKind === 'preview'),
  },
  photos: {
    key: 'photos', appIds: ids(['photos', 'photo-booth'], ['photos', 'fictional-camera']), utilityKinds: ['photos-library', 'photos-booth', 'photos-image'],
    createState: createPhotosState, schema: photosStateSchema, validate: validatePhotosState,
    createCommands: ctx => createPhotosCommands(ctx), catalog: photosCatalog, component: 'PhotosApp.svelte',
    componentForWindow: (_, window) => window.appId === 'photos' ? 'PhotosApp.svelte' : 'PhotoBoothApp.svelte', menus: args => photosMenus(args.profile, args.state, args.windowId),
    windowMetadata: (profile, options = {}) => photosWindowMetadata(profile, options.booth === true || options.appId === 'photo-booth' || options.appId === 'fictional-camera'), sessions: windowsOf,
  },
  media: {
    key: 'media', appIds: profile => windows(profile) ? ['media-player', 'sound-recorder'] : classic(profile) ? ['quicktime', 'itunes', ...(profile.id.includes('mojave') ? ['voice-memos'] : [])] : ['quicktime', 'music', 'tv', 'podcasts', 'voice-memos'],
    utilityKinds: ['media-player', 'sound-recorder', 'voice-local-equivalent'], createState: createMediaState, schema: mediaStateSchema, validate: validateMediaState,
    createCommands: ctx => createMediaCommands(ctx), catalog: mediaCatalog, component: 'NativeMediaApp.svelte', menus: mediaMenus,
    windowMetadata: mediaWindowMetadata, sessions: sessionsOf, project: projectMedia,
  },
  maps: { key: 'maps', appIds: ids(['maps']), utilityKinds: [], createState: createMapsState, schema: mapsSchema, validate: validateMapsState, createCommands: ctx => createMapsCommands(ctx), catalog: mapsCatalog, component: 'MapsApp.svelte', menus: args => args.menuId ? mapsMenuProvider(args) : ['maps', 'file', 'edit', 'view', 'window', 'help'].map(menuId => ({ id: menuId, label: menuId === 'maps' ? 'Maps' : menuId[0].toUpperCase() + menuId.slice(1), items: mapsMenuProvider({ ...args, menuId }) })), windowMetadata: profile => bounds('maps', windows(profile) ? 'Windows Maps' : 'Maps', 1024, 720, 640, 420, { disclosure: mapsCapabilities(profile).availability }), sessions: windowsOf },
  findmy: { key: 'findmy', appIds: ids(['findmy']), utilityKinds: [], createState: createFindMyState, schema: findMySchema, validate: validateFindMyState, createCommands: ctx => createFindMyCommands(ctx.getState(), ctx), catalog: findMyCatalog, component: 'FindMyApp.svelte', menus: findMyMenus, windowMetadata: findMyWindowMetadata, sessions: windowsOf, project: projectFindMyState, rehydrate: rehydrateFindMyState },
  books: { key: 'books', appIds: ids(['books'], ['fictional-books']), utilityKinds: [], createState: createBooksState, schema: booksSchema, validate: validateBooksState, createCommands: ctx => createBooksCommands(ctx), catalog: booksCatalog, component: 'BooksApp.svelte', menus: booksMenus, windowMetadata: profile => { const cap = booksCapabilities(profile); return bounds(cap.appId, cap.label, 1040, 720, 680, 440, { disclosure: cap.availability }); }, sessions: windowsOf },
  calculator: { key: 'calculator', appIds: ids(['calculator', 'local-calculator', 'local-radix-lab']), utilityKinds: ['calculator'], createState: createCalculatorState, schema: calculatorSchema, validate: validateCalculatorState, createCommands: ctx => createCalculatorCommands(ctx.getState(), ctx), catalog: calculatorCatalog, component: 'CalculatorApp.svelte', menus: calculatorMenus, windowMetadata: calculatorWindowMetadata, sessions: windowsOf },
  dictionary: { key: 'dictionary', appIds: ids(['dictionary']), utilityKinds: [], createState: createDictionaryState, schema: dictionarySchema, validate: validateDictionaryState, createCommands: ctx => createDictionaryCommands(ctx.getState(), ctx), catalog: dictionaryCatalog, component: 'DictionaryApp.svelte', menus: args => dictionaryMenus(args.profile, args.state, args.windowId), windowMetadata: profile => bounds('dictionary', dictionaryNativeCapability(profile).label, 820, 600, 600, 380), sessions: sessionsOf },
  stickies: { key: 'stickies', appIds: ids(['stickies']), utilityKinds: [], createState: createStickiesState, schema: stickiesSchema, validate: validateStickiesState, createCommands: ctx => createStickiesCommands(ctx.getState(), ctx), catalog: stickiesCatalog, component: 'StickiesApp.svelte', menus: stickiesMenus, windowMetadata: profile => bounds('stickies', windows(profile) ? 'Stickies — Local Equivalent' : 'Stickies', 300, 260, 220, 120, { disclosure: stickiesCapabilities(profile).availability }), sessions: windowsOf },
  stocks: { key: 'stocks', appIds: ids(['stocks']), utilityKinds: [], createState: createStocksState, schema: stocksSchema, validate: validateStocksState, createCommands: ctx => createStocksCommands(ctx.getState(), ctx), catalog: stocksCatalog, component: 'StocksApp.svelte', menus: args => stocksMenus(args.profile, args.state, args.windowId), windowMetadata: profile => bounds('stocks', stocksCapabilities(profile).label, 1040, 720, 680, 420), sessions: windowsOf },
  news: { key: 'news', appIds: ids(['news']), utilityKinds: [], createState: createNewsState, schema: newsSchema, validate: validateNewsState, createCommands: ctx => createNewsCommands(ctx.getState(), ctx), catalog: newsCatalog, component: 'NewsApp.svelte', menus: args => newsMenus(args.profile, args.state, args.windowId), windowMetadata: newsWindowMetadata, sessions: windowsOf },
  home: { key: 'home', appIds: ids(['home']), utilityKinds: [], createState: createHomeState, schema: homeSchema, validate: validateHomeState, createCommands: ctx => createHomeCommands(ctx.getState(), ctx), catalog: homeCatalog, component: 'HomeApp.svelte', menus: args => homeMenus(args.state, args.profile, args.windowId), windowMetadata: profile => bounds('home', homeCapabilities(profile).label, 1040, 720, 680, 420), sessions: windowsOf },
  chess: { key: 'chess', appIds: ids(['chess'], ['chess-local']), utilityKinds: [], createState: createChessState, schema: chessSchema, validate: validateChessState, createCommands: ctx => createChessCommands(ctx.getState(), ctx), catalog: chessCatalog, component: 'ChessApp.svelte', menus: args => chessMenuItems(args.state, args.windowId), windowMetadata: profile => { const cap = chessAvailability(profile); return bounds(cap.appId, cap.label, 800, 700, 600, 500, { disclosure: cap.disclosure }); }, sessions: sessionsOf },
  dvd: { key: 'dvd', appIds: profile => [dvdAvailability(profile).appId], utilityKinds: ['dvd-local-equivalent'], createState: createDVDState, schema: dvdSchema, validate: validateDVDState, createCommands: ctx => createDVDCommands(ctx.getState(), ctx), catalog: dvdCatalog, component: 'DVDPlayerApp.svelte', menus: args => dvdMenuItems(args.state, args.windowId), windowMetadata: profile => { const cap = dvdAvailability(profile); return bounds(cap.appId, cap.label, 920, 650, 640, 420, { disclosure: cap.disclosure, ...(windows(profile) ? { utilityKind: 'dvd-local-equivalent' } : {}) }); }, sessions: sessionsOf, project: state => { const saved = copyCanonicalData(state); for (const row of saved.sessions) row.playing = false; return saved; } },
  store: { key: 'store', appIds: ids(['appstore'], ['microsoft-store']), utilityKinds: ['store'], createState: createStoreState, schema: storeSchema, validate: validateStoreState, createCommands: ctx => createStoreCommands(ctx.getState(), ctx), catalog: storeCatalog, component: 'AppStoreApp.svelte', menus: args => storeMenus(args.profile, args.state, args.windowId), windowMetadata: storeWindowMetadata, sessions: sessionsOf },
  preferences: { key: 'preferences', appIds: ids(['settings']), utilityKinds: [], createState: createPreferencesState, schema: preferencesSchema, validate: validatePreferencesState, createCommands: ctx => createPreferencesCommands(ctx.getState(), ctx), catalog: preferencesCatalog, component: 'NativePreferencesApp.svelte', menus: args => preferencesMenu(args.profile, preferencesSession(args.state, args.windowId)), windowMetadata: profile => bounds('settings', windows(profile) ? 'Settings' : classic(profile) ? 'System Preferences' : 'System Settings', classic(profile) ? 780 : 980, 680, 680, 460), sessions: sessionsOf, project: preferencesSavedState, rehydrate: restorePreferencesState },
  terminal: { key: 'terminal', appIds: ids(['terminal']), utilityKinds: [], createState: createTerminalState, schema: terminalSchema, validate: validateTerminalState, createCommands: ctx => createTerminalCommands(ctx.getState(), ctx), catalog: terminalCatalog, component: 'TerminalApp.svelte', menus: args => terminalMenuItems(args.state, args.windowId), windowMetadata: terminalWindowMetadata, sessions: sessionsOf },
  scriptEditor: { key: 'scriptEditor', appIds: ids(['scripteditor'], ['scripteditor-local']), utilityKinds: [], createState: createScriptEditorState, schema: scriptEditorSchema, validate: validateScriptEditorState, createCommands: ctx => createScriptEditorCommands(ctx.getState(), ctx), catalog: scriptEditorCatalog, component: 'ScriptEditorApp.svelte', menus: args => scriptEditorMenuItems(args.state, args.windowId), windowMetadata: profile => bounds(windows(profile) ? 'scripteditor-local' : 'scripteditor', windows(profile) ? 'Script Editor — Local Equivalent' : 'Script Editor', 900, 640, 600, 400), sessions: sessionsOf, project: scriptEditorForPersistence, rehydrate: rehydrateScriptEditorState },
  automator: { key: 'automator', appIds: ids(['automator'], ['automator-local']), utilityKinds: [], createState: createAutomatorState, schema: automatorSchema, validate: validateAutomatorState, createCommands: ctx => createAutomatorCommands(ctx.getState(), ctx), catalog: automatorCatalog, component: 'AutomatorApp.svelte', menus: args => automatorMenuItems(args.state, args.windowId), windowMetadata: automatorWindowMetadata, sessions: sessionsOf, project: projectAutomatorState, rehydrate: rehydrateAutomatorState },
  archive: { key: 'archive', appIds: ids(['archive-utility'], ['archive-utility-local']), utilityKinds: [], createState: createArchiveState, schema: archiveSchema, validate: validateArchiveState, createCommands: ctx => createArchiveCommands(ctx.getState(), ctx), catalog: archiveCatalog, component: 'ArchiveUtilityApp.svelte', menus: args => archiveMenuItems(args.state, args.windowId), windowMetadata: archiveWindowMetadata, sessions: sessionsOf, project: state => { const saved = copyCanonicalData(state); for (const row of saved.sessions) if (row.status === 'running') { row.status = 'cancelled'; row.progress = 0; } return saved; } },
  activity: { key: 'activity', appIds: ids(['activitymonitor'], ['taskmanager']), utilityKinds: [], createState: createActivityState, schema: activitySchema, validate: validateActivityState, createCommands: ctx => createActivityCommands(ctx.getState(), ctx), catalog: activityCatalog, component: 'ActivityApp.svelte', menus: args => activityMenuItems(args.state, args.windowId), windowMetadata: profile => { const cap = activityAvailability(profile); return bounds(cap.appId, cap.label, 900, 600, 600, 340); }, sessions: sessionsOf },
  console: { key: 'console', appIds: ids(['console'], ['eventviewer']), utilityKinds: [], createState: createConsoleState, schema: consoleSchema, validate: validateConsoleState, createCommands: ctx => createConsoleCommands(ctx.getState(), ctx), catalog: consoleCatalog, component: 'ConsoleApp.svelte', menus: args => consoleMenus(args.profile, args.state, args.windowId, args.context.getSceneEvents()), windowMetadata: profile => { const cap = consoleAvailability(profile); return bounds(cap.appId, cap.label, 1040, 660, 760, 460); }, sessions: sessionsOf, project: consolePersistenceState, rehydrate: rehydrateConsoleState },
  systeminformation: { key: 'systeminformation', appIds: ids(['systeminformation'], ['msinfo32']), utilityKinds: [], createState: createSystemInformationState, schema: systemInformationSchema, validate: validateSystemInformationState, createCommands: ctx => createSystemInformationCommands(ctx.getState(), ctx), catalog: systemInformationCatalog, component: 'SystemInformationApp.svelte', menus: args => systemInformationMenuItems(args.state, args.windowId), windowMetadata: profile => { const cap = systemInformationAvailability(profile); return bounds(cap.appId, cap.label, 960, 640, 640, 400); }, sessions: sessionsOf },
  colorMeter: { key: 'colorMeter', appIds: ids(['colormeter']), utilityKinds: [], createState: createColorMeterState, schema: colorMeterSchema, validate: validateColorMeterState, createCommands: ctx => createColorMeterCommands(ctx.getState(), ctx), catalog: colorMeterCatalog, component: 'ColorMeterApp.svelte', menus: colorMeterMenus, windowMetadata: profile => ({ ...colorMeterWindowMetadata, title: colorMeterCapabilities(profile).label }), sessions: windowsOf },
  colorsync: { key: 'colorsync', appIds: ids(['colorsync']), utilityKinds: ['colorsync'], createState: createColorSyncState, schema: colorSyncSchema, validate: validateColorSyncState, createCommands: ctx => createColorSyncCommands(ctx.getState(), ctx), catalog: colorSyncCatalog, component: 'ColorSyncApp.svelte', menus: colorSyncMenus, windowMetadata: colorSyncWindowMetadata, sessions: windowsOf },
  grapher: { key: 'grapher', appIds: ids(['grapher']), utilityKinds: ['grapher'], createState: createGrapherState, schema: grapherSchema, validate: validateGrapherState, createCommands: ctx => createGrapherCommands(ctx.getState(), ctx), catalog: grapherCatalog, component: 'GrapherApp.svelte', menus: grapherMenus, windowMetadata: grapherWindowMetadata, sessions: windowsOf, project: state => { const saved = copyCanonicalData(state); for (const row of saved.windows) row.document.animation.playing = false; return saved; } },
  imageCapture: { key: 'imageCapture', appIds: ids(['imagecapture']), utilityKinds: ['imagecapture'], createState: createImageCaptureState, schema: imageCaptureSchema, validate: validateImageCaptureState, createCommands: ctx => createImageCaptureCommands(ctx.getState(), ctx), catalog: imageCaptureCatalog, component: 'ImageCaptureApp.svelte', menus: imageCaptureMenus, windowMetadata: imageCaptureWindowMetadata, sessions: windowsOf },
  bluetoothExchange: { key: 'bluetoothExchange', appIds: ids(['bluetoothfileexchange']), utilityKinds: ['bluetoothfileexchange'], createState: createBluetoothExchangeState, schema: bluetoothExchangeSchema, validate: validateBluetoothExchangeState, createCommands: ctx => createBluetoothExchangeCommands(ctx.getState(), ctx), catalog: bluetoothExchangeCatalog, component: 'BluetoothExchangeApp.svelte', menus: bluetoothExchangeMenus, windowMetadata: bluetoothExchangeWindowMetadata, sessions: windowsOf },
  keychain: { key: 'keychain', appIds: ids(['keychain']), utilityKinds: ['keychain'], createState: createKeychainState, schema: keychainSchema, validate: validateKeychainState, createCommands: ctx => createKeychainCommands(ctx.getState(), ctx), catalog: keychainCatalog, component: 'KeychainApp.svelte', menus: args => { const session = args.state.windows.find(row => row.windowId === args.windowId); return keychainMenus({ session, keychain: args.state.keychains.find(row => row.id === session?.keychainId), selected: args.state.items.find(row => row.id === session?.selectedId), preferences: args.state.preferences, classic: classic(args.profile) }); }, windowMetadata: keychainWindowMetadata, sessions: windowsOf, project: keychainPersistenceProjection },
  fontbook: { key: 'fontbook', appIds: ids(['fontbook']), utilityKinds: ['fontbook'], createState: createFontBookState, schema: fontBookSchema, validate: validateFontBookState, createCommands: ctx => createFontBookCommands(ctx.getState(), ctx), catalog: fontBookCatalog, component: 'FontBookApp.svelte', menus: args => { const session = args.state.windows.find(row => row.windowId === args.windowId), fonts = args.context.getShared('fonts'); return fontBookMenus({ session, selected: fonts?.fonts.find(row => row.id === session?.selectedId), classic: classic(args.profile) }); }, windowMetadata: fontBookWindowMetadata, sessions: windowsOf, project: fontBookPersistenceProjection },
  fonts: { key: 'fonts', appIds: ids([]), utilityKinds: [], createState: createFontGraph, schema: fontGraphSchema, validate: validateFontGraph, createCommands: null, catalog: {}, component: null, menus: none, windowMetadata: () => null, sessions: none, shared: true },
  audioMidi: { key: 'audioMidi', appIds: ids(['audiomidi']), utilityKinds: ['audiomidi'], createState: createAudioMidiState, schema: audioMidiSchema, validate: validateAudioMidiState, createCommands: ctx => createAudioMidiCommands(ctx.getState(), ctx), catalog: audioMidiCatalog, component: 'AudioMidiApp.svelte', menus: audioMidiMenus, windowMetadata: audioMidiWindowMetadata, sessions: windowsOf, project: audioMidiSessionData, rehydrate: restoreAudioMidiState },
  voiceOver: { key: 'voiceOver', appIds: ids(['voiceover']), utilityKinds: ['voiceover'], createState: createVoiceOverState, schema: voiceOverSchema, validate: validateVoiceOverState, createCommands: ctx => createVoiceOverCommands(ctx.getState(), ctx), catalog: voiceOverCatalog, component: 'VoiceOverApp.svelte', menus: voiceOverMenus, windowMetadata: voiceOverWindowMetadata, sessions: windowsOf, project: voiceOverSessionData, rehydrate: restoreVoiceOverState },
  networkutility: { key: 'networkutility', appIds: ids(['networkutility']), utilityKinds: ['networkutility'], createState: createNetworkUtilityState, schema: networkUtilitySchema, validate: validateNetworkUtilityState, createCommands: ctx => createNetworkUtilityCommands(ctx.getState(), ctx), catalog: networkUtilityCatalog, component: 'NetworkUtilityApp.svelte', menus: networkUtilityMenus, windowMetadata: networkUtilityWindowMetadata, sessions: windowsOf, project: networkUtilityPersistentState, rehydrate: rehydrateNetworkUtilityState },
  airport: { key: 'airport', appIds: ids(['airport']), utilityKinds: ['airport'], createState: createAirportState, schema: airportSchema, validate: validateAirportState, createCommands: ctx => createAirportCommands(ctx.getState(), ctx), catalog: airportCatalog, component: 'AirportApp.svelte', menus: airportMenus, windowMetadata: airportWindowMetadata, sessions: windowsOf, project: airportPersistentState, rehydrate: rehydrateAirportState },
  disk: { key: 'disk', appIds: ids(['diskutility'], ['diskutility-local']), utilityKinds: ['disk'], createState: createDiskState, schema: diskSchema, validate: validateDiskState, createCommands: ctx => createDiskCommands(ctx.getState(), ctx), catalog: diskCatalog, component: 'NativeDiskUtilityApp.svelte', menus: args => diskMenuItems(args.state, args.windowId, args.controller), windowMetadata: profile => diskWindowMetadata(profile, { family: 'disk' }), sessions: sessionsOf, project: projectDiskState, rehydrate: rehydrateDiskState },
  backup: { key: 'backup', appIds: ids(['timemachine'], ['timemachine-local']), utilityKinds: ['time-machine'], createState: createBackupState, schema: backupSchema, validate: validateBackupState, createCommands: ctx => createBackupCommands(ctx.getState(), ctx), catalog: backupCatalog, component: 'NativeTimeMachineApp.svelte', menus: args => timeMachineMenuItems(args.state, args.windowId), windowMetadata: profile => diskWindowMetadata(profile, { family: 'backup' }), sessions: sessionsOf, project: projectBackupState, rehydrate: rehydrateBackupState },
  migration: { key: 'migration', appIds: ids(['migration'], ['migration-local']), utilityKinds: ['migration'], createState: createMigrationState, schema: migrationSchema, validate: validateMigrationState, createCommands: ctx => createMigrationCommands(ctx.getState(), ctx), catalog: migrationCatalog, component: 'NativeMigrationAssistantApp.svelte', menus: args => migrationMenuItems(args.state, args.windowId), windowMetadata: profile => diskWindowMetadata(profile, { family: 'migration' }), sessions: sessionsOf, project: projectMigrationState, rehydrate: rehydrateMigrationState },
  bootCamp: { key: 'bootCamp', appIds: ids(['bootcamp'], ['bootcamp-local']), utilityKinds: ['boot-camp'], createState: createBootCampState, schema: bootCampSchema, validate: validateBootCampState, createCommands: ctx => createBootCampCommands(ctx.getState(), ctx), catalog: bootCampCatalog, component: 'NativeBootCampAssistantApp.svelte', menus: args => bootCampMenuItems(args.state, args.windowId), windowMetadata: profile => diskWindowMetadata(profile, { family: 'bootcamp' }), sessions: sessionsOf, project: projectBootCampState, rehydrate: rehydrateBootCampState },
  pages: { key: 'pages', appIds: ids(['pages'], ['pages-local']), utilityKinds: ['pages'], createState: createPagesState, schema: pagesStateSchema, validate: validatePagesState, createCommands: ctx => createPagesCommands(ctx), catalog: pagesCatalog, component: 'PagesApp.svelte', menus: pagesMenus, windowMetadata: pagesWindowMetadata, sessions: windowsOf },
  numbers: { key: 'numbers', appIds: ids(['numbers'], ['numbers-local']), utilityKinds: ['numbers'], createState: createNumbersState, schema: numbersStateSchema, validate: validateNumbersState, createCommands: ctx => createNumbersCommands(ctx), catalog: numbersCatalog, component: 'NumbersApp.svelte', menus: numbersMenus, windowMetadata: numbersWindowMetadata, sessions: windowsOf },
  keynote: { key: 'keynote', appIds: ids(['keynote'], ['keynote-local']), utilityKinds: ['keynote'], createState: createKeynoteState, schema: keynoteStateSchema, validate: validateKeynoteState, createCommands: ctx => createKeynoteCommands(ctx.getState(), ctx), catalog: keynoteCatalog, component: 'KeynoteApp.svelte', menus: args => keynoteMenus(args.profile, args.state, args.windowId), windowMetadata: profile => { const cap = keynoteAvailability(profile); return { ...keynoteWindowMetadata(profile), appId: cap.appId, disclosure: cap.disclosure }; }, sessions: sessionsOf, project: keynotePersistenceState, rehydrate: rehydrateKeynoteState },
  word: { key: 'word', appIds: ids(['word']), utilityKinds: ['word'], createState: createWordState, schema: wordSchema, validate: validateWordState, createCommands: ctx => createWordCommands(ctx.getState(), ctx), catalog: wordCatalog, component: 'WordApp.svelte', menus: wordMenus, windowMetadata: wordWindowMetadata, sessions: windowsOf },
  excel: { key: 'excel', appIds: ids(['excel']), utilityKinds: ['excel'], createState: createExcelState, schema: excelSchema, validate: validateExcelState, createCommands: ctx => createExcelCommands(ctx.getState(), ctx), catalog: excelCatalog, component: 'ExcelApp.svelte', menus: excelMenus, windowMetadata: excelWindowMetadata, sessions: windowsOf },
  powerpoint: { key: 'powerpoint', appIds: ids(['powerpoint']), utilityKinds: ['powerpoint'], createState: createPowerPointState, schema: powerpointSchema, validate: validatePowerPointState, createCommands: ctx => createPowerPointCommands(ctx.getState(), ctx), catalog: powerpointCatalog, component: 'PowerPointApp.svelte', menus: powerpointMenus, windowMetadata: powerpointWindowMetadata, sessions: windowsOf, project: state => { const saved = copyCanonicalData(state); for (const row of saved.windows) { row.presentation.active = false; row.presentation.playing = false; } return saved; } },
  xcode: { key: 'xcode', appIds: ids(['xcode'], ['xcode-local']), utilityKinds: [], createState: createXcodeState, schema: xcodeSchema, validate: validateXcodeState, createCommands: ctx => createXcodeCommands(ctx.getState(), ctx), catalog: xcodeCatalog, component: 'XcodeApp.svelte', menus: args => xcodeMenuItems(args.state, args.windowId), windowMetadata: profile => { const cap = xcodeAvailability(profile); return { ...xcodeWindowMetadata, appId: cap.appId, title: cap.label, disclosure: cap.disclosure }; }, sessions: sessionsOf, project: xcodePersistenceProjection, rehydrate: rehydrateXcodeState },
  clockApp: { key: 'clockApp', appIds: ids(['clock']), utilityKinds: [], createState: (profile, { sceneTime, originalSDKClock } = {}) => originalSDKClock ? migrateWindowsClockState(originalSDKClock, profile, sceneTime) : createClockAppState(profile, sceneTime), schema: clockAppSchema, validate: validateClockAppState, createCommands: ctx => createClockAppCommands(ctx), catalog: clockAppCatalog(), component: 'NativeClockApp.svelte', menus: args => clockAppMenus(args.state, args.windowId), windowMetadata: profile => { const cap = clockAppMeta(profile); return bounds(cap.appId, cap.localEquivalent ? 'Clock — Local Equivalent' : cap.name, cap.window.width, cap.window.height, 600, 420, { disclosure: cap.disclosure }); }, sessions: windowsOf },
  weatherApp: { key: 'weatherApp', appIds: ids(['weather']), utilityKinds: [], createState: weatherAppDefaults, schema: weatherAppSchema, validate: validateWeatherAppState, createCommands: ctx => createWeatherAppCommands(ctx.getState(), ctx), catalog: weatherAppCatalog(), component: 'NativeWeatherApp.svelte', menus: args => weatherAppMenus(args.profile, args.state, args.windowId, args.context.getShared('widgets'), args.context.getShared('preferences')), windowMetadata: profile => { const cap = weatherAppMeta(profile); return bounds(cap.appId, cap.name, cap.window.width, cap.window.height, 640, 480, { disclosure: cap.disclosure }); }, sessions: windowsOf, project: state => { const saved = copyCanonicalData(state); for (const row of saved.windows) row.mapPlaying = false; return saved; } },
  shortcuts: { key: 'shortcuts', appIds: ids(['shortcuts']), utilityKinds: [], createState: createShortcutsState, schema: shortcutsSchema, validate: validateShortcutsState, createCommands: ctx => createShortcutsCommands(ctx.getState(), ctx), catalog: shortcutsCatalog, component: 'ShortcutsApp.svelte', menus: args => shortcutsMenus(args.state, args.windowId), windowMetadata: shortcutsWindowMetadata, sessions: sessionsOf, project: projectShortcutsState, rehydrate: rehydrateShortcutsState },
  screenshot: { key: 'screenshot', appIds: profile => [screenshotAppId(profile)], utilityKinds: [], createState: createScreenshotState, schema: screenshotSchema, validate: validateScreenshotState, createCommands: ctx => createScreenshotCommands(ctx.getState(), ctx), catalog: screenshotCatalog, component: 'ScreenshotApp.svelte', menus: screenshotMenus, windowMetadata: screenshotWindowMetadata, sessions: windowsOf },
  magnifier: { key: 'magnifier', appIds: ids(['magnifier']), utilityKinds: [], createState: createMagnifierState, schema: magnifierSchema, validate: validateMagnifierState, createCommands: ctx => createMagnifierCommands(ctx.getState(), ctx), catalog: magnifierCatalog, component: 'MagnifierApp.svelte', menus: magnifierMenus, windowMetadata: profile => ({ ...magnifierWindowMetadata, title: windows(profile) ? 'Magnifier' : 'Zoom — Local Equivalent', disclosure: captureToolCapabilities(profile, 'magnifier').qualification }), sessions: windowsOf },
  games: { key: 'games', appIds: ids(['games']), utilityKinds: ['games'], createState: createGamesState, schema: gamesSchema, validate: validateGamesState, createCommands: ctx => createGamesCommands(ctx.getState(), ctx), catalog: gamesCatalog, component: 'GamesApp.svelte', menus: gamesMenus, windowMetadata: profile => ({ ...gamesWindowMetadata(profile), ...(!profile.id.includes('golden-gate') ? { title: 'Games — Local Equivalent' } : {}) }), sessions: windowsOf },
  tips: { key: 'tips', appIds: ids(['tips']), utilityKinds: ['tips'], createState: createTipsState, schema: tipsSchema, validate: validateTipsState, createCommands: ctx => createTipsCommands(ctx.getState(), ctx), catalog: tipsCatalog, component: 'TipsApp.svelte', menus: tipsMenus, windowMetadata: tipsWindowMetadata, sessions: windowsOf },
  screenSharing: { key: 'screenSharing', appIds: ids(['screensharing']), utilityKinds: ['screensharing'], createState: createScreenSharingState, schema: screenSharingSchema, validate: validateScreenSharingState, createCommands: ctx => createScreenSharingCommands(ctx.getState(), ctx), catalog: screenSharingCatalog, component: 'ScreenSharingApp.svelte', menus: screenSharingMenus, windowMetadata: screenSharingWindowMetadata, sessions: windowsOf, project: screenSharingPersistenceProjection, rehydrate: rehydrateScreenSharingState },
  phone: { key: 'phone', appIds: ids(['phone']), utilityKinds: [], createState: createPhoneState, schema: phoneFamilySchema, validate: validatePhoneState, createCommands: ctx => createPhoneCommands(ctx), catalog: phoneCatalog, component: 'PhoneApp.svelte', menus: args => phoneMenus(args.profile, args.state, args.windowId), windowMetadata: profile => { const cap = phoneAvailability(profile); return { ...phoneWindowMetadata(profile), ...(!cap.native ? { title: 'Phone — Local Equivalent' } : {}), disclosure: cap.disclosure }; }, sessions: windowsOf, project: phoneSavedState, rehydrate: restorePhoneState },
  mirroring: { key: 'mirroring', appIds: ids(['iphonemirroring']), utilityKinds: [], createState: createMirroringState, schema: phoneFamilySchema, validate: validatePhoneState, createCommands: ctx => createMirroringCommands(ctx), catalog: mirroringCatalog, component: 'IPhoneMirroringApp.svelte', menus: args => mirroringMenus(args.profile, args.state, args.windowId), windowMetadata: profile => { const cap = phoneAvailability(profile, true); return { ...phoneWindowMetadata(profile, true), ...(!cap.native ? { title: 'iPhone Mirroring — Local Equivalent' } : {}), disclosure: cap.disclosure }; }, sessions: windowsOf, project: phoneSavedState, rehydrate: restorePhoneState },
  journal: { key: 'journal', appIds: ids(['journal']), utilityKinds: ['journal'], createState: createJournalState, schema: journalSchema, validate: validateJournalState, createCommands: ctx => createJournalCommands(ctx.getState(), ctx), catalog: journalCatalog, component: 'JournalApp.svelte', menus: args => journalMenus(args.profile, args.state, args.windowId), windowMetadata: journalWindowMetadata, sessions: sessionsOf, project: journalPersistenceState, rehydrate: rehydrateJournalState },
  freeform: { key: 'freeform', appIds: profile => [freeformAvailability(profile).appId], utilityKinds: ['freeform'], createState: createFreeformState, schema: freeformStateSchema, validate: validateFreeformState, createCommands: ctx => createFreeformCommands(ctx.getState(), ctx), catalog: freeformCatalog, component: 'FreeformApp.svelte', menus: args => freeformMenus(args.profile, args.state, args.windowId), windowMetadata: freeformWindowMetadata, sessions: sessionsOf, project: freeformPersistenceState, rehydrate: rehydrateFreeformState },
  imageplayground: { key: 'imageplayground', appIds: ids(['imageplayground']), utilityKinds: ['imageplayground'], createState: createImagePlaygroundState, schema: imagePlaygroundStateSchema, validate: validateImagePlaygroundState, createCommands: ctx => createImagePlaygroundCommands(ctx.getState(), ctx), catalog: imagePlaygroundCatalog, component: 'ImagePlaygroundApp.svelte', menus: args => imagePlaygroundMenus(args.profile, args.state, args.windowId), windowMetadata: imagePlaygroundWindowMetadata, sessions: sessionsOf, project: imagePlaygroundPersistenceState, rehydrate: rehydrateImagePlaygroundState },
  passwords: { key: 'passwords', appIds: ids(['passwords']), utilityKinds: ['passwords'], createState: createPasswordsState, schema: passwordsSchema, validate: validatePasswordsState, createCommands: ctx => createPasswordsCommands(ctx.getState(), ctx), catalog: passwordsCatalog, component: 'PasswordsApp.svelte', menus: args => { const session = passwordsWindow(args.state, args.windowId), keychain = args.context.getShared('keychain'); return nativeMenuRequests(passwordsMenus({ session, authorized: passwordsAuthorized(session, keychain.keychains.find(row => row.id === session?.keychainId), args.context.getShared('preferences'), args.context.getShared('session')), selected: keychain.items.find(row => row.id === session?.selectedId) }), args.windowId); }, windowMetadata: passwordsWindowMetadata, sessions: windowsOf, project: passwordsPersistentState, rehydrate: rehydratePasswordsState },
  directoryutility: { key: 'directoryutility', appIds: ids(['directoryutility']), utilityKinds: ['directoryutility'], createState: createDirectoryUtilityState, schema: directoryUtilitySchema, validate: validateDirectoryUtilityState, createCommands: ctx => createDirectoryUtilityCommands(ctx.getState(), ctx), catalog: directoryUtilityCatalog, component: 'DirectoryUtilityApp.svelte', menus: args => { const session = directoryUtilityWindow(args.state, args.windowId); return nativeMenuRequests(directoryUtilityMenus({ session, authorized: directoryUtilityAuthorized(session, args.context.getShared('preferences'), args.context.getShared('session')), classic: classic(args.profile) }), args.windowId); }, windowMetadata: directoryUtilityWindowMetadata, sessions: windowsOf, project: directoryUtilityPersistentState, rehydrate: rehydrateDirectoryUtilityState },
  siriai: { key: 'siriai', appIds: ids(['siriai']), utilityKinds: ['siriai'], createState: createSiriAssistantState, schema: siriAssistantSchema, validate: validateSiriAssistantState, createCommands: ctx => createSiriAssistantCommands(ctx.getState(), ctx), catalog: siriAssistantCatalog, component: 'SiriAssistantApp.svelte', menus: siriAssistantMenus, windowMetadata: siriAssistantWindowMetadata, sessions: windowsOf, project: siriAssistantPersistentState, rehydrate: rehydrateSiriAssistantState },
};

function mediaWindowMetadata(profile, options = {}) {
  const appId = options.appId ?? (windows(profile) ? 'media-player' : 'quicktime');
  const app = options.mediaApp ?? (['voice-memos', 'sound-recorder'].includes(appId) ? 'voice' : appId === 'quicktime' ? 'quicktime' : 'library');
  const kind = appId === 'tv' ? 'movie' : appId === 'podcasts' ? 'podcast' : 'music';
  const cap = mediaNativeCapability(profile, app, kind);
  const title = ({ quicktime: 'QuickTime Player', itunes: 'iTunes', music: 'Music', tv: 'TV', podcasts: 'Podcasts', 'voice-memos': 'Voice Memos', 'media-player': 'Media Player', 'sound-recorder': 'Sound Recorder' })[appId];
  return bounds(appId, title, app === 'quicktime' ? 820 : app === 'voice' ? 860 : 1000, app === 'quicktime' ? 560 : app === 'voice' ? 580 : 680, app === 'quicktime' ? 460 : app === 'voice' ? 600 : 700, app === 'quicktime' ? 320 : app === 'voice' ? 400 : 440, { utilityKind: cap.utilityKind, mediaApp: app, disclosure: cap.disclosure });
}
function mediaMenus({ state, windowId, view }) {
  const session = state.sessions.find(row => row.windowId === windowId), target = { windowId };
  const asset = state.assets.find(row => row.id === session?.assetId), library = session?.app === 'library';
  const item = (id, label, command, payload = {}, enabled = !!session, extra = {}) => ({ id, label, enabled, ...extra, ...(enabled ? { request: { command, target, payload } } : {}) });
  const panel = (id, label, value, enabled = !!session) => item(id, label, 'media.panel', { panel: value }, enabled);
  const playable = !!asset && !session?.recording && view?.available?.() === true;
  const groups = [
    { id: 'app', label: ({ quicktime: 'QuickTime Player', itunes: 'iTunes', music: 'Music', tv: 'TV', podcasts: 'Podcasts', 'voice-memos': 'Voice Memos', 'media-player': 'Media Player', 'sound-recorder': 'Sound Recorder' })[session?.nativeAppId] ?? 'Media', items: [panel('about', 'About', 'help'), panel('preferences', 'Preferences…', 'preferences')] },
    { id: 'file', label: 'File', items: [item('open', 'Open File…', 'media.open'), item('import', 'Import…', 'media.import', {}, library), panel('record', 'New Recording…', 'record', !!session && !library), item('save', 'Save', 'media.save', {}, !!asset), panel('export', 'Export…', 'export', !!asset), item('share', 'Share…', 'media.share', {}, !!asset), item('close', 'Close', 'window.close')] },
    { id: 'edit', label: 'Edit', items: [item('trim', 'Trim to Selection', 'media.trim', { start: session?.selectionStart ?? 0, end: session?.selectionEnd ?? 0 }, !!asset && session.selectionEnd > session.selectionStart), item('split', 'Split Clip', 'media.split', { position: session?.position ?? 0 }, !!asset && session.position > 0 && session.position < asset.duration), panel('info', 'Get Info…', 'info', !!asset), item('favorite', session?.assetId && asset?.favorite ? 'Remove Favorite' : 'Favorite', 'media.favorite', { enabled: !asset?.favorite }, library && !!asset)] },
    { id: 'view', label: 'View', items: [panel('inspector', 'Show Movie Inspector', 'inspector', !!asset), item('mini', session?.mini ? 'Switch to Full Player' : 'Switch to MiniPlayer', 'media.mini', { enabled: !session?.mini }), item('full-window', session?.fullWindow ? 'Exit Full Window' : 'Enter Full Window', 'media.fullWindow', { enabled: !session?.fullWindow }), panel('equalizer', 'Equalizer…', 'equalizer', library), item('visualizer', 'Visualizer', 'media.visualizer', { enabled: session?.panel !== 'visualizer' }, library, { checked: session?.panel === 'visualizer' })] },
    { id: 'playback', label: 'Playback', items: [item('play', session?.playing ? 'Pause' : 'Play', session?.playing ? 'media.pause' : 'media.play', {}, playable), item('previous', 'Previous', 'media.queue', { operation: 'previous' }, playable && library && session.queue.length > 0), item('next', 'Next', 'media.queue', { operation: 'next' }, playable && library && session.queue.length > 0), item('loop', 'Loop', 'media.loop', { enabled: !session?.loop }, !!asset, { checked: session?.loop === true }), item('shuffle', 'Shuffle', 'media.shuffle', { enabled: !session?.shuffle }, library, { checked: session?.shuffle === true }), ...['off', 'one', 'all'].map(mode => item(`repeat-${mode}`, `Repeat ${mode === 'off' ? 'Off' : mode === 'one' ? 'One' : 'All'}`, 'media.repeat', { mode }, library, { checked: session?.repeat === mode }))] },
    { id: 'help', label: 'Help', items: [panel('help', 'Local Media Help', 'help')] },
  ];
  return groups;
}
function projectMedia(state) {
  const saved = copyCanonicalData(state);
  for (const session of saved.sessions) { session.playing = false; session.recording = null; }
  return saved;
}

// UI adapters return original sources. They neither clone authorities nor fill in
// missing Root bindings with invented graphs or success-returning controls.
nativeDomainDefinitions.media.extraProps = ({ context }) => ({ sound: context.getShared('sound') });
nativeDomainDefinitions.findmy.extraProps = ({ context }) => ({ sources: { bluetooth: context.getShared('bluetooth'), contacts: context.getShared('contacts'), messages: context.getShared('messages'), preferences: context.getShared('preferences'), maps: context.getShared('maps'), sound: context.getShared('sound') } });
nativeDomainDefinitions.dvd.extraProps = ({ context }) => ({ sound: context.getShared('sound') });
nativeDomainDefinitions.books.extraProps = ({ context, controller }) => ({ readBook: controller.readBook, getFile: context.getFile });
nativeDomainDefinitions.fontbook.extraProps = ({ context }) => ({ fontGraph: context.getShared('fonts'), getFile: context.getFile });
nativeDomainDefinitions.audioMidi.extraProps = ({ context }) => ({ sound: context.getShared('sound') });
nativeDomainDefinitions.voiceOver.extraProps = ({ context }) => ({ preferences: context.getShared('preferences'), input: context.getShared('input'), sound: context.getShared('sound') });
nativeDomainDefinitions.imageCapture.extraProps = ({ context }) => ({ getFile: context.getFile });
nativeDomainDefinitions.bluetoothExchange.extraProps = ({ context }) => ({ bluetooth: context.getShared('bluetooth'), getFile: context.getFile });
nativeDomainDefinitions.activity.extraProps = ({ context }) => ({ getInventory: context.getInventory, getSceneTime: context.getSceneTime });
nativeDomainDefinitions.systeminformation.extraProps = ({ context }) => ({ inventory: context.getInventory(), sceneTime: context.getSceneTime() });
nativeDomainDefinitions.terminal.extraProps = ({ context }) => ({ files: context.getInventory().files });
nativeDomainDefinitions.automator.extraProps = ({ context }) => ({ files: context.getFilesStore().files, applications: context.getInventory().applications });
nativeDomainDefinitions.archive.extraProps = ({ context }) => ({ listFiles: () => context.getFilesStore().files.filter(file => context.getFile(file.id) === file), getFile: context.getFile });
nativeDomainDefinitions.scriptEditor.extraProps = ({ controller }) => ({ dictionary: controller.dictionary });
nativeDomainDefinitions.grapher.extraProps = ({ context }) => ({ sceneTime: context.getSceneTime() });
nativeDomainDefinitions.powerpoint.extraProps = ({ context }) => ({ sceneTime: context.getSceneTime() });
nativeDomainDefinitions.console.extraProps = ({ controller }) => ({ controller });
nativeDomainDefinitions.keynote.extraProps = ({ controller }) => ({ controller });
nativeDomainDefinitions.disk.extraProps = ({ controller }) => ({ controller });
nativeDomainDefinitions.backup.extraProps = ({ controller }) => ({ controller });
nativeDomainDefinitions.migration.extraProps = ({ controller }) => ({ controller });
nativeDomainDefinitions.bootCamp.extraProps = ({ controller }) => ({ controller });
nativeDomainDefinitions.networkutility.extraProps = ({ context }) => ({ preferences: context.getShared('preferences'), wifi: context.getShared('wifi'), inventory: context.getInventory() });
nativeDomainDefinitions.airport.extraProps = nativeDomainDefinitions.networkutility.extraProps;
nativeDomainDefinitions.preferences.extraProps = ({ context, shared, ownership, executeEnvelope, notificationExecute, registerNotificationView }) => ({ shared, inventory: context.getInventory(), ownership, execute: executeEnvelope, notificationExecute, registerNotificationView });
nativeDomainDefinitions.stickies.extraProps = ({ executeEnvelope, registerView, onWindowDrag }) => ({ dispatch: executeEnvelope, onRegisterNativeView: registerView, onWindowDrag });
nativeDomainDefinitions.clockApp.extraProps = ({ context }) => ({ sceneTime: context.getSceneTime(), systemClock: context.getShared('clock'), widgets: context.getShared('widgets') });
nativeDomainDefinitions.weatherApp.extraProps = ({ context }) => ({ widgets: context.getShared('widgets'), preferences: context.getShared('preferences'), sceneTime: context.getSceneTime(), systemClock: context.getShared('clock') });
nativeDomainDefinitions.shortcuts.extraProps = nativeDomainDefinitions.automator.extraProps;
nativeDomainDefinitions.magnifier.extraProps = ({ context }) => ({ getShared: context.getShared });
nativeDomainDefinitions.games.extraProps = ({ context }) => ({ store: context.getShared('store'), chess: context.getShared('chess') });
nativeDomainDefinitions.screenSharing.extraProps = ({ context }) => ({ preferences: context.getShared('preferences'), localSession: context.getShared('session'), getFile: context.getFile });
nativeDomainDefinitions.phone.extraProps = ({ context }) => ({ getSceneTime: context.getSceneTime, shared: { contacts: context.getShared('contacts'), calls: context.getShared('calls'), messages: context.getShared('messages'), photos: context.getShared('photos'), bluetooth: context.getShared('bluetooth'), preferences: context.getShared('preferences') } });
nativeDomainDefinitions.mirroring.extraProps = nativeDomainDefinitions.phone.extraProps;
nativeDomainDefinitions.journal.extraProps = ({ controller }) => ({ controller });
nativeDomainDefinitions.freeform.extraProps = nativeDomainDefinitions.journal.extraProps;
nativeDomainDefinitions.imageplayground.extraProps = nativeDomainDefinitions.journal.extraProps;
nativeDomainDefinitions.passwords.extraProps = ({ context }) => ({ keychain: context.getShared('keychain'), preferences: context.getShared('preferences'), sceneSession: context.getShared('session'), showMenuBar: windows(context.profile) });
nativeDomainDefinitions.directoryutility.extraProps = ({ context }) => ({ preferences: context.getShared('preferences'), sceneSession: context.getShared('session'), showMenuBar: windows(context.profile) });
nativeDomainDefinitions.siriai.extraProps = ({ context }) => ({ preferences: context.getShared('preferences'), contacts: context.getShared('contacts'), calendar: context.getShared('calendar'), notes: context.getShared('notes') });

function nativeMenuRequests(groups, windowId) {
  const convert = (entry, fallbackId) => {
    const { command, target, payload, request, items, children, title, disabled, ...fields } = entry;
    const id = entry.id ?? title ?? fallbackId, label = entry.label ?? title;
    const enabled = entry.enabled !== false && disabled !== true;
    const nested = children ?? items;
    const packet = request ?? (command ? { command, target, payload: payload ?? {} } : null);
    return { ...fields, id, ...(label !== undefined ? { label } : {}), enabled,
      ...(nested ? { children: nested.map((item, index) => convert(item, `${id}.${index}`)) } : {}),
      ...(enabled && packet ? { request: { ...packet, target: packet.target ?? { windowId } } } : {}) };
  };
  return groups.map((group, index) => convert(group, `native-menu-${index}`));
}

export const nativeDomainSchemas = Object.fromEntries(Object.values(nativeDomainDefinitions).map(row => [row.key, row.schema]));
export const nativeWindowUtilityKinds = [...new Set(Object.values(nativeDomainDefinitions).flatMap(row => row.utilityKinds))];
export const nativeDomainCatalog = Object.assign({}, ...Object.values(nativeDomainDefinitions).map(row => row.catalog));

export function nativeDomainForWindow(profile, actualWindow) {
  if (!actualWindow || !NATIVE_PROFILE_IDS.includes(profile?.id)) return null;
  for (const row of Object.values(nativeDomainDefinitions)) {
    if (row.ownsWindow ? row.ownsWindow(profile, actualWindow) : row.appIds(profile).includes(actualWindow.appId)
      && (!actualWindow.utilityKind || row.utilityKinds.includes(actualWindow.utilityKind))) return row;
  }
  return null;
}

export function nativeAppMetadata(profile) {
  const applications = {};
  for (const row of Object.values(nativeDomainDefinitions)) {
    for (const appId of row.appIds(profile)) {
      if (['local-calculator', 'local-radix-lab'].includes(appId) || row.key === 'preview' && windows(profile)) continue;
      const metadata = row.windowMetadata(profile, { appId, ...(appId === 'notepad' ? { documentKind: 'plain' } : appId === 'wordpad' ? { documentKind: 'rich' } : {}) });
      if (!metadata) continue;
      const { title, minWidth, minHeight } = metadata;
      applications[appId] = { id: appId, name: title, icon: appId, width: metadata.width, height: metadata.height,
        minimumSize: { width: minWidth, height: minHeight }, multipleWindows: true, quitAllowed: true,
        coverage: 'native-interior', domainKey: row.key, component: row.componentForWindow?.(profile, { appId }) ?? row.component,
        launchOptions: nativeLaunchOptions(row.key, appId, metadata), ...(metadata.utilityKind ? { utilityKind: metadata.utilityKind } : {}),
        ...(metadata.disclosure ? { disclosure: metadata.disclosure } : {}), ...(metadata.defaultHidden ? { defaultHidden: true, hiddenDock: true } : {}) };
    }
  }
  if (!windows(profile)) {
    applications.facetime = { id: 'facetime', name: 'FaceTime', icon: 'facetime', width: 900, height: 650,
      minimumSize: { width: 600, height: 400 }, multipleWindows: true, quitAllowed: true, coverage: 'calls.local',
      domainKey: 'calls', component: 'CallsApp.svelte', launchOptions: {} };
    applications.reminders = { id: 'reminders', name: 'Reminders', icon: 'reminders', width: 1000, height: 700,
      minimumSize: { width: 640, height: 420 }, multipleWindows: true, quitAllowed: true, coverage: 'apps.reminders',
      domainKey: 'reminders', component: 'RemindersApp.svelte', launchOptions: {} };
  }
  return applications;
}

function nativeLaunchOptions(key, appId, metadata) {
  const options = {};
  if (metadata.utilityKind) options.utilityKind = metadata.utilityKind;
  if (key === 'textedit') options.documentKind = metadata.documentKind;
  if (key === 'media') options.mediaApp = metadata.mediaApp;
  if (key === 'calculator') options.mode = 'basic';
  return options;
}

// Computed from the Store's actual installed records; never another writable registry.
export function nativeInstalledAppMetadata(store, profile) {
  if (!store) return {};
  return Object.fromEntries(storeInstalledDescriptors(store, profile).map(descriptor => {
    const metadata = calculatorWindowMetadata(profile, { appId: descriptor.appId, mode: descriptor.launchOptions.mode });
    return [descriptor.appId, { ...descriptor, width: metadata.width, height: metadata.height,
      minimumSize: { width: metadata.minWidth, height: metadata.minHeight }, multipleWindows: true, quitAllowed: true,
      domainKey: 'calculator', coverage: 'native-interior', component: 'CalculatorApp.svelte' }];
  }));
}

export function projectNativeDomain(key, state, profile) {
  const row = nativeDomainDefinitions[key];
  if (!row || !result(row.validate(state, profile))?.ok) throw new TypeError(`Invalid ${key} canonical graph.`);
  const saved = row.project ? row.project(state, profile) : copyCanonicalData(state);
  if (!result(row.validate(saved, profile))?.ok) throw new TypeError(`Invalid ${key} persistence projection.`);
  return saved;
}
export function rehydrateNativeDomain(key, state, profile) {
  const row = nativeDomainDefinitions[key];
  if (!row || !result(row.validate(state, profile))?.ok) throw new TypeError(`Invalid saved ${key} graph.`);
  const restored = row.rehydrate ? row.rehydrate(state, profile) : projectNativeDomain(key, state, profile);
  if (!restored || !result(row.validate(restored, profile))?.ok) throw new TypeError(`Invalid restored ${key} graph.`);
  return restored;
}

export function validateNativeDomains(seed, profile) {
  if (!NATIVE_PROFILE_IDS.includes(profile?.id)) return { ok: false, message: 'Unknown installed profile.' };
  for (const row of Object.values(nativeDomainDefinitions)) {
    const validation = result(row.validate(seed[row.key], profile));
    if (!validation?.ok) return { ok: false, message: `${row.key}: ${validation?.message ?? 'Invalid canonical graph.'}` };
  }
  const disks = validateDiskFiles(seed.disk, seed.files);
  if (!disks.ok) return disks;
  const backups = validateBackupFiles(seed.backup, seed.files);
  if (!backups.ok) return backups;
  return { ok: true };
}

export function validateNativeDomainWindows(seed, profile, windows) {
  const managed = new Map(windows.map(window => [window.id, window]));
  if (managed.size !== windows.length) return { ok: false, message: 'Duplicate actual managed window identity.' };
  const owners = new Set();
  for (const row of Object.values(nativeDomainDefinitions)) {
    const sessions = row.sessions(seed[row.key]);
    for (const session of sessions) {
      const id = row.sessionId ? row.sessionId(session) : session.windowId;
      const window = managed.get(id);
      if (owners.has(id) || !window || nativeDomainForWindow(profile, window) !== row
        || session.nativeAppId && session.nativeAppId !== window.appId || session.appId && session.appId !== window.appId)
        return { ok: false, message: `${row.key}: canonical session must own exactly one original registered window.` };
      owners.add(id);
    }
  }
  for (const window of windows) if (nativeDomainForWindow(profile, window) && !owners.has(window.id)) return { ok: false, message: 'A registered native window is missing its canonical session.' };
  return { ok: true };
}
