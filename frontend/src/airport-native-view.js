import {airportWindow} from './airport-state.js';
import {createNetworkNativeView} from './network-utility-native-view.js';
export function createAirportNativeView(options){return createNetworkNativeView({...options,findWindow:airportWindow,prefix:'airport'});}
