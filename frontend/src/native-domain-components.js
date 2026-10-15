// Svelte-only composition. Node schema/profile consumers import the pure registry.
import BrowserApp from './BrowserApp.svelte';
import NativeChromeApp from './NativeChromeApp.svelte';
import TextEditApp from './TextEditApp.svelte';
import PreviewApp from './PreviewApp.svelte';
import PhotosApp from './PhotosApp.svelte';
import PhotoBoothApp from './PhotoBoothApp.svelte';
import NativeMediaApp from './NativeMediaApp.svelte';
import MapsApp from './MapsApp.svelte';
import FindMyApp from './FindMyApp.svelte';
import BooksApp from './BooksApp.svelte';
import CalculatorApp from './CalculatorApp.svelte';
import DictionaryApp from './DictionaryApp.svelte';
import StickiesApp from './StickiesApp.svelte';
import StocksApp from './StocksApp.svelte';
import NewsApp from './NewsApp.svelte';
import HomeApp from './HomeApp.svelte';
import ChessApp from './ChessApp.svelte';
import DVDPlayerApp from './DVDPlayerApp.svelte';
import AppStoreApp from './AppStoreApp.svelte';
import NativePreferencesApp from './NativePreferencesApp.svelte';
import TerminalApp from './TerminalApp.svelte';
import ScriptEditorApp from './ScriptEditorApp.svelte';
import AutomatorApp from './AutomatorApp.svelte';
import ArchiveUtilityApp from './ArchiveUtilityApp.svelte';
import ActivityApp from './ActivityApp.svelte';
import ConsoleApp from './ConsoleApp.svelte';
import SystemInformationApp from './SystemInformationApp.svelte';
import ColorMeterApp from './ColorMeterApp.svelte';
import ColorSyncApp from './ColorSyncApp.svelte';
import GrapherApp from './GrapherApp.svelte';
import ImageCaptureApp from './ImageCaptureApp.svelte';
import BluetoothExchangeApp from './BluetoothExchangeApp.svelte';
import KeychainApp from './KeychainApp.svelte';
import FontBookApp from './FontBookApp.svelte';
import AudioMidiApp from './AudioMidiApp.svelte';
import VoiceOverApp from './VoiceOverApp.svelte';
import NetworkUtilityApp from './NetworkUtilityApp.svelte';
import AirportApp from './AirportApp.svelte';
import NativeDiskUtilityApp from './NativeDiskUtilityApp.svelte';
import NativeTimeMachineApp from './NativeTimeMachineApp.svelte';
import NativeMigrationAssistantApp from './NativeMigrationAssistantApp.svelte';
import NativeBootCampAssistantApp from './NativeBootCampAssistantApp.svelte';
import PagesApp from './PagesApp.svelte';
import NumbersApp from './NumbersApp.svelte';
import KeynoteApp from './KeynoteApp.svelte';
import WordApp from './WordApp.svelte';
import ExcelApp from './ExcelApp.svelte';
import PowerPointApp from './PowerPointApp.svelte';
import XcodeApp from './XcodeApp.svelte';
import NativeClockApp from './NativeClockApp.svelte';
import NativeWeatherApp from './NativeWeatherApp.svelte';
import ShortcutsApp from './ShortcutsApp.svelte';
import ScreenshotApp from './ScreenshotApp.svelte';
import MagnifierApp from './MagnifierApp.svelte';
import GamesApp from './GamesApp.svelte';
import TipsApp from './TipsApp.svelte';
import ScreenSharingApp from './ScreenSharingApp.svelte';
import PhoneApp from './PhoneApp.svelte';
import IPhoneMirroringApp from './IPhoneMirroringApp.svelte';
import JournalApp from './JournalApp.svelte';
import FreeformApp from './FreeformApp.svelte';
import ImagePlaygroundApp from './ImagePlaygroundApp.svelte';
import PasswordsApp from './PasswordsApp.svelte';
import DirectoryUtilityApp from './DirectoryUtilityApp.svelte';
import SiriAssistantApp from './SiriAssistantApp.svelte';
import CallsApp from './CallsApp.svelte';
import RemindersApp from './RemindersApp.svelte';
import NotesApp from './NotesApp.svelte';
import MailApp from './MailApp.svelte';
import ContactsApp from './ContactsApp.svelte';
import CalendarApp from './CalendarApp.svelte';

export const nativeDomainComponents = Object.freeze({
  'BrowserApp.svelte': BrowserApp, 'NativeChromeApp.svelte': NativeChromeApp,
  'TextEditApp.svelte': TextEditApp, 'PreviewApp.svelte': PreviewApp,
  'PhotosApp.svelte': PhotosApp, 'PhotoBoothApp.svelte': PhotoBoothApp,
  'NativeMediaApp.svelte': NativeMediaApp, 'MapsApp.svelte': MapsApp,
  'FindMyApp.svelte': FindMyApp,
  'BooksApp.svelte': BooksApp, 'CalculatorApp.svelte': CalculatorApp,
  'DictionaryApp.svelte': DictionaryApp, 'StickiesApp.svelte': StickiesApp,
  'StocksApp.svelte': StocksApp, 'NewsApp.svelte': NewsApp, 'HomeApp.svelte': HomeApp,
  'ChessApp.svelte': ChessApp, 'DVDPlayerApp.svelte': DVDPlayerApp,
  'AppStoreApp.svelte': AppStoreApp, 'NativePreferencesApp.svelte': NativePreferencesApp,
  'TerminalApp.svelte': TerminalApp, 'ScriptEditorApp.svelte': ScriptEditorApp,
  'AutomatorApp.svelte': AutomatorApp, 'ArchiveUtilityApp.svelte': ArchiveUtilityApp,
  'ActivityApp.svelte': ActivityApp, 'ConsoleApp.svelte': ConsoleApp,
  'SystemInformationApp.svelte': SystemInformationApp, 'ColorMeterApp.svelte': ColorMeterApp,
  'ColorSyncApp.svelte': ColorSyncApp, 'GrapherApp.svelte': GrapherApp,
  'ImageCaptureApp.svelte': ImageCaptureApp, 'BluetoothExchangeApp.svelte': BluetoothExchangeApp,
  'KeychainApp.svelte': KeychainApp, 'FontBookApp.svelte': FontBookApp,
  'AudioMidiApp.svelte': AudioMidiApp, 'VoiceOverApp.svelte': VoiceOverApp,
  'NetworkUtilityApp.svelte': NetworkUtilityApp, 'AirportApp.svelte': AirportApp,
  'NativeDiskUtilityApp.svelte': NativeDiskUtilityApp, 'NativeTimeMachineApp.svelte': NativeTimeMachineApp,
  'NativeMigrationAssistantApp.svelte': NativeMigrationAssistantApp,
  'NativeBootCampAssistantApp.svelte': NativeBootCampAssistantApp,
  'PagesApp.svelte': PagesApp,
  'NumbersApp.svelte': NumbersApp, 'KeynoteApp.svelte': KeynoteApp,
  'WordApp.svelte': WordApp, 'ExcelApp.svelte': ExcelApp,
  'PowerPointApp.svelte': PowerPointApp, 'XcodeApp.svelte': XcodeApp,
  'NativeClockApp.svelte': NativeClockApp, 'NativeWeatherApp.svelte': NativeWeatherApp,
  'ShortcutsApp.svelte': ShortcutsApp, 'ScreenshotApp.svelte': ScreenshotApp,
  'MagnifierApp.svelte': MagnifierApp, 'GamesApp.svelte': GamesApp, 'TipsApp.svelte': TipsApp,
  'ScreenSharingApp.svelte': ScreenSharingApp, 'PhoneApp.svelte': PhoneApp,
  'IPhoneMirroringApp.svelte': IPhoneMirroringApp, 'JournalApp.svelte': JournalApp,
  'FreeformApp.svelte': FreeformApp, 'ImagePlaygroundApp.svelte': ImagePlaygroundApp,
  'PasswordsApp.svelte': PasswordsApp, 'DirectoryUtilityApp.svelte': DirectoryUtilityApp,
  'SiriAssistantApp.svelte': SiriAssistantApp,
  'CallsApp.svelte': CallsApp, 'RemindersApp.svelte': RemindersApp,
  'NotesApp.svelte': NotesApp, 'MailApp.svelte': MailApp,
  'ContactsApp.svelte': ContactsApp, 'CalendarApp.svelte': CalendarApp,
});
