import { expect, test } from 'bun:test';
import { spotlightAnswer } from '../frontend/src/spotlight-answers.js';

function result(query, kind, value, precision = 10) {
  const answer = spotlightAnswer(query);
  expect(answer).not.toBeNull();
  expect(answer.kind).toBe(kind);
  expect(answer.error).toBeNull();
  expect(answer.value).toBeCloseTo(value, precision);
  return answer;
}

function rejected(query, kind, reason) {
  const answer = spotlightAnswer(query);
  expect(answer).not.toBeNull();
  expect(answer.kind).toBe(kind);
  expect(answer.value).toBeNull();
  expect(answer.error).toMatch(reason);
}

test('Apple Spotlight examples compute locally with explicit conversion provenance', () => {
  result('15% of 85', 'calculation', 12.75);
  result('120 × 1.08', 'calculation', 129.6);
  result('√144', 'calculation', 12);
  result('32°F in Celsius', 'conversion', 0);
  result('5 miles in km', 'conversion', 8.04672);
  const currency = result('€200 in USD', 'conversion', 235.2941176470588);
  expect(currency.detail).toMatch(/fixed fictional/i);
});

test('arithmetic uses conventional precedence, right associative powers and literal percentages', () => {
  for (const [query, value] of [
    ['2 + 3 * 4', 14], ['(2 + 3) * 4', 20], ['2^3^2', 512], ['-2^2', -4],
    ['(-2)^2', 4], ['2^-3', 0.125], ['2^+3', 8], ['8 / 4 / 2', 1],
    ['10 - 3 - 2', 5], ['200 + 10%', 200.1], ['50%%', 0.005],
    ['.5e+2 + 1.25e-1', 50.125], ['sqrt(81) + √16', 13],
    ['sqrt 2^2', 2], ['−3 × -2 ÷ +4', 1.5], ['-0', 0],
  ]) result(query, 'calculation', value);
  expect(Object.is(spotlightAnswer('-0').value, -0)).toBe(false);
});

test('finite real errors are visible and malformed suffixes cannot execute code', () => {
  for (const [query, reason] of [
    ['1 / 0', /zero/i], ['0 / 0', /zero/i], ['0^-1', /zero/i],
    ['√-1', /nonnegative/i], ['(-1)^.5', /integer exponent/i],
    ['1e309', /finite range/i], ['1e308 * 10', /overflow/i], ['10^400', /overflow/i],
    ['2 +', /expected/i], ['(2 + 3', /parenthesis/i], ['2 + 3)', /suffix/i],
    ['2(3)', /multiplication/i], ['1..2', /suffix/i], ['1e+', /unexpected/i],
    ['2 - mystery', /unexpected/i], ['2 + Math.random()', /unexpected/i],
    ['1;globalThis.spotlightInjected = 1', /unexpected/i],
    ['sqrt()', /expected/i], ['2 ** 3', /expected/i],
  ]) rejected(query, 'calculation', reason);
});

test('query, token and nesting boundaries return honest errors without breaking later answers', () => {
  result(`1${' '.repeat(255)}`, 'calculation', 1);
  rejected(`1${' '.repeat(256)}`, 'calculation', /256.*UTF-16/i);
  rejected(`${'('.repeat(33)}1${')'.repeat(33)}`, 'calculation', /nested/i);
  result(`${'('.repeat(32)}1${')'.repeat(32)}`, 'calculation', 1);
  rejected(`${'-'.repeat(33)}1`, 'calculation', /nested/i);
  rejected(`${'1+'.repeat(64)}1`, 'calculation', /tokens/i);
  result(`${'1+'.repeat(63)}1`, 'calculation', 64);
  rejected(`${'2^'.repeat(33)}1`, 'calculation', /nested/i);
  result('2 + 2', 'calculation', 4);
});

test('conversion dimensions include international lengths and avoirdupois mass', () => {
  for (const [query, value] of [
    ['1 inch to cm', 2.54], ['5 in in cm', 12.7], ['1 ft to inches', 12],
    ['1 yard to ft', 3], ['1 nmi to m', 1852], ['1 μm to nm', 1000],
    ['1e3 mm to metres', 1], ['16 oz in pounds', 1], ['1 lb to kg', 0.45359237],
    ['1 stone in lb', 14], ['1 tonne to kg', 1000], ['1000 mg to g', 1],
  ]) result(query, 'conversion', value);
  expect(spotlightAnswer('1 oz to g').detail).toMatch(/avoirdupois/i);
});

test('temperature conversions preserve offsets and exact freezing and absolute-zero boundaries', () => {
  for (const [query, value] of [
    ['32°F in Celsius', 0], ['0°C to Fahrenheit', 32], ['100 celsius to f', 212],
    ['273.15 K in celsius', 0], ['-273.15°C to K', 0], ['0 K to Fahrenheit', -459.67],
    ['-40 F in C', -40], ['212 F to K', 373.15],
  ]) result(query, 'conversion', value);
  const large = spotlightAnswer('1e308 F to C');
  expect(large.error).toBeNull();
  expect(large.value.toExponential(14)).toBe('5.55555555555556e+307');
  rejected('1e308 C to F', 'conversion', /overflow/i);
});

test('duration, area and volume use their own dimensions and explicit regional liquid units', () => {
  for (const [query, value] of [
    ['1 week in hours', 168], ['2 days to minutes', 2880], ['1000 ms to sec', 1],
    ['1 km² in m2', 1000000], ['1 square foot to square inches', 144],
    ['1 ha to m^2', 10000], ['1 acre in m²', 4046.8564224],
    ['1 liter in cm3', 1000], ['1 cubic meter to l', 1000],
    ['1 cubic foot in cubic inches', 1728], ['100 cl to l', 1], ['10 dl in l', 1],
    ['1 US gallon to l', 3.785411784], ['1 imperial gallon in liters', 4.54609],
    ['1 us cup in ml', 236.5882365], ['1 us fl oz to ml', 29.5735295625],
    ['1 us liquid pint to us fluid ounces', 16], ['1 us quart to us pints', 2],
  ]) result(query, 'conversion', value);
  expect(spotlightAnswer('1 us gal to l').detail).toMatch(/US liquid gallons/);
});

test('data preserves bit/byte symbol case and distinguishes decimal from binary prefixes', () => {
  for (const [query, value] of [
    ['1 B in b', 8], ['8 b in B', 1], ['1 MB to bytes', 1000000],
    ['1 Mb to B', 125000], ['1 MiB to bytes', 1048576], ['1 GB in MB', 1000],
    ['1 GiB in MiB', 1024], ['1 KiB to kb', 8.192], ['1 kB in bit', 8000],
    ['1 kibibit in bit', 1024], ['1 MiB to Mibit', 8], ['1 PB in TB', 1000],
    ['1 PiB in TiB', 1024], ['1 gigabyte in megabits', 8000],
  ]) result(query, 'conversion', value);
  rejected('1 mb in bytes', 'conversion', /unknown|ambiguous/i);
});

test('currency aliases use one disclosed authored USD basis and never conflate pounds with sterling', () => {
  for (const [query, value] of [
    ['$100 to EUR', 85], ['100 USD in GBP', 76], ['USD 1 in JPY', 112],
    ['£76 to USD', 100], ['¥112 in USD', 1], ['1 euro to EUR', 1],
    ['1 GBP to pounds sterling', 1],
    ['€200 USD', 235.2941176470588], ['€200USD', 235.2941176470588],
    ['USD200 EUR', 170], ['€-200 USD', -235.2941176470588],
  ]) {
    const converted = result(query, 'conversion', value);
    expect(converted.detail).toMatch(/fixed fictional/i);
    expect(converted.detail).toMatch(/no live market data/i);
  }
  rejected('1 pounds to GBP', 'conversion', /incompatible.*mass.*currency/i);
  expect(spotlightAnswer('€200 Budget')).toBeNull();
});

test('unknown, ambiguous, incompatible and malformed conversions do not fabricate results', () => {
  for (const [query, reason] of [
    ['5 miles in kg', /incompatible.*length.*mass/i],
    ['1 m² in m', /incompatible.*area.*length/i], ['1 l in m²', /incompatible.*volume.*area/i],
    ['1 USD to bit', /incompatible.*currency.*data/i],
    ['5 furlongs to m', /unknown.*source/i], ['1 m in widgets', /unknown.*target/i],
    ['1 ton in kg', /ambiguous/i], ['1 gallon in l', /ambiguous/i],
    ['1 cup in ml', /ambiguous/i], ['1 month in days', /unknown/i],
    ['1 m/s to km/h', /unknown/i], ['1e309 m in cm', /finite range/i],
    ['1e308 km to nm', /overflow/i], ['5 miles in', /quantity.*target/i],
    ['5 to km', /number.*source/i], ['€ in USD', /number.*source/i],
  ]) rejected(query, 'conversion', reason);
  result('5 miles in miles', 'conversion', 5);
});

test('ordinary source-search text and non-string inputs remain outside the answer surface', () => {
  for (const query of [
    '', '   ', 'Résumé', 'sqrtology', 'report in folder', 'meeting in 5 minutes',
    '2026 report', '200 dollar budget', 'Celsius', '5 miles', '+budget', '-report',
    'a'.repeat(257), null, undefined, 12, {}, [],
  ]) expect(spotlightAnswer(query)).toBeNull();
  const first = result('  2 + 3  ', 'calculation', 5);
  first.value = 99;
  first.error = 'changed';
  result('  2 + 3  ', 'calculation', 5);
});

test('conversion and UTF-16 overflow obey the same public query bound as calculation', () => {
  result(`1 m to cm${' '.repeat(247)}`, 'conversion', 100);
  rejected(`1 m to cm${' '.repeat(248)}`, 'conversion', /256.*UTF-16/i);
  rejected(`1+${'😀'.repeat(128)}`, 'calculation', /256.*UTF-16/i);
});
