import {createDeviceUtilityNativeView} from './image-capture-native-view.js';
import {bluetoothExchangeWindow} from './bluetooth-exchange-state.js';
export function createBluetoothExchangeNativeView(options){return createDeviceUtilityNativeView({...options,prefix:'bluetooth-exchange',getSession:bluetoothExchangeWindow});}
