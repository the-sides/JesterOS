import { calculatorDecimal, calculatorBinary, encodeCalculatorValue, decodeCalculatorValue, CalculatorError } from './calculator-engine.js';
const unit=(id,label,scale,offset='0')=>Object.freeze({id,label,scale,offset});
// SI definitions, not a canned pair table. Temperature is affine; all other
// physical categories use exact decimal factors. Currency is authored fiction.
export const CALCULATOR_UNITS=Object.freeze({
 length:[unit('m','Meters','1'),unit('km','Kilometers','1000'),unit('cm','Centimeters','0.01'),unit('mm','Millimeters','0.001'),unit('in','Inches','0.0254'),unit('ft','Feet','0.3048'),unit('yd','Yards','0.9144'),unit('mi','Miles','1609.344')],
 area:[unit('m2','Square meters','1'),unit('km2','Square kilometers','1000000'),unit('ft2','Square feet','0.09290304'),unit('acre','Acres','4046.8564224'),unit('ha','Hectares','10000')],
 volume:[unit('l','Liters','1'),unit('ml','Milliliters','0.001'),unit('m3','Cubic meters','1000'),unit('gal','US gallons','3.785411784'),unit('qt','US quarts','0.946352946'),unit('cup','US cups','0.2365882365'),unit('floz','US fluid ounces','0.0295735295625')],
 mass:[unit('kg','Kilograms','1'),unit('g','Grams','0.001'),unit('mg','Milligrams','0.000001'),unit('lb','Pounds','0.45359237'),unit('oz','Ounces','0.028349523125'),unit('tonne','Metric tons','1000')],
 temperature:[unit('K','Kelvin','1'),unit('C','Celsius','1','273.15'),unit('F','Fahrenheit','0.5555555555555556','255.3722222222222')],
 time:[unit('s','Seconds','1'),unit('min','Minutes','60'),unit('h','Hours','3600'),unit('day','Days','86400'),unit('week','Weeks','604800')],
 speed:[unit('mps','Meters per second','1'),unit('kph','Kilometers per hour','0.2777777777777778'),unit('mph','Miles per hour','0.44704'),unit('knot','Knots','0.5144444444444444')],
 pressure:[unit('Pa','Pascals','1'),unit('kPa','Kilopascals','1000'),unit('bar','Bar','100000'),unit('atm','Atmospheres','101325'),unit('psi','Pounds per square inch','6894.757293168')],
 energy:[unit('J','Joules','1'),unit('kJ','Kilojoules','1000'),unit('cal','Thermochemical calories','4.184'),unit('kcal','Kilocalories','4184'),unit('kWh','Kilowatt-hours','3600000')],
 power:[unit('W','Watts','1'),unit('kW','Kilowatts','1000'),unit('hp','Mechanical horsepower','745.6998715822702')],
 currency:[unit('USD','US Dollar','1'),unit('EUR','Euro','1'),unit('GBP','British Pound','1'),unit('JPY','Japanese Yen','1'),unit('CAD','Canadian Dollar','1'),unit('AUD','Australian Dollar','1')]
});
export const CALCULATOR_CATEGORIES=Object.keys(CALCULATOR_UNITS);
export const CALCULATOR_FIXED_RATES=Object.freeze([{id:'USD',perUSD:'1'},{id:'EUR',perUSD:'0.92'},{id:'GBP',perUSD:'0.79'},{id:'JPY',perUSD:'148.5'},{id:'CAD',perUSD:'1.36'},{id:'AUD',perUSD:'1.52'}].map(Object.freeze));
export function calculatorConvert(value,category,from,to,rates){
 const source=CALCULATOR_UNITS[category]?.find(u=>u.id===from),destination=CALCULATOR_UNITS[category]?.find(u=>u.id===to);if(!source||!destination)throw new CalculatorError('unit','Choose two units from the same category.');
 const v=value.n===undefined?decodeCalculatorValue(value):value;
 if(category==='currency'){const a=rates.find(r=>r.id===from),b=rates.find(r=>r.id===to);if(!a||!b)throw new CalculatorError('unit','The fixed scene currency is unavailable.');return encodeCalculatorValue(calculatorBinary('*',calculatorBinary('/',v,calculatorDecimal(a.perUSD)),calculatorDecimal(b.perUSD)));}
 // Fahrenheit and km/h use rational definitions, avoiding rounded repeating factors.
 const scale=u=>u.id==='F'?calculatorBinary('/',calculatorDecimal('5'),calculatorDecimal('9')):u.id==='kph'?calculatorBinary('/',calculatorDecimal('5'),calculatorDecimal('18')):u.id==='knot'?calculatorBinary('/',calculatorDecimal('463'),calculatorDecimal('900')):calculatorDecimal(u.scale);
 const offset=u=>u.id==='F'?calculatorBinary('-',calculatorDecimal('273.15'),calculatorBinary('*',calculatorDecimal('32'),scale(u))):calculatorDecimal(u.offset);
 const si=calculatorBinary('+',calculatorBinary('*',v,scale(source)),offset(source));if(category==='temperature'&&si.n<0n)throw new CalculatorError('domain','Temperature cannot be below absolute zero.');
 return encodeCalculatorValue(calculatorBinary('/',calculatorBinary('-',si,offset(destination)),scale(destination)));
}
