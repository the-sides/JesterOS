// Authored local coverage, not a host calculator or live currency service.
// Physical factors: NIST SP 811 Appendix B.8; data prefixes: NIST/IEC binary prefixes.
const QUERY_LIMIT = 256;
const TOKEN_LIMIT = 128;
const DEPTH_LIMIT = 32;
const NUMBER = '(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?';
const literal = new RegExp(`^${NUMBER}`);
const quantity = new RegExp(`^([+-]?${NUMBER})\\s*(.+)$`, 'u');
const prefixQuantity = new RegExp(`^([$€£¥]|USD|EUR|GBP|JPY)\\s*([+-]?${NUMBER})$`, 'iu');
const prefixConversion = new RegExp(`^([$€£¥]|USD|EUR|GBP|JPY)\\s*([+-]?${NUMBER})\\s*(USD|EUR|GBP|JPY|[$€£¥])$`, 'iu');
const rateDisclosure = 'Fixed fictional scene rates: USD 1 = EUR 0.85 = GBP 0.76 = JPY 112. No live market data.';
const calculationDetail = 'Local arithmetic · decimal/scientific numbers · + − × ÷ ^ · percentages · square roots';
const unitAliases = new Map();
const dataSymbols = new Map();
const normalizeUnit = text => text.trim().replace(/\s+/gu, ' ').replace(/μ/gu, 'µ').toLowerCase();
function unit(category, label, scale, aliases, zero = 0) {
  const record = { category, label, scale, zero };
  for (const alias of aliases) unitAliases.set(normalizeUnit(alias), record);
  return record;
}

const lengthUnits = [
  ['Nanometers', 1e-9, ['nm', 'nanometer', 'nanometers', 'nanometre', 'nanometres']],
  ['Micrometers', 1e-6, ['µm', 'um', 'micrometer', 'micrometers', 'micrometre', 'micrometres', 'micron', 'microns']],
  ['Millimeters', 0.001, ['mm', 'millimeter', 'millimeters', 'millimetre', 'millimetres']],
  ['Centimeters', 0.01, ['cm', 'centimeter', 'centimeters', 'centimetre', 'centimetres']],
  ['Meters', 1, ['m', 'meter', 'meters', 'metre', 'metres']],
  ['Kilometers', 1000, ['km', 'kilometer', 'kilometers', 'kilometre', 'kilometres']],
  ['Inches (international)', 0.0254, ['in', 'inch', 'inches']],
  ['Feet (international)', 0.3048, ['ft', 'foot', 'feet']],
  ['Yards (international)', 0.9144, ['yd', 'yard', 'yards']],
  ['Miles (international)', 1609.344, ['mi', 'mile', 'miles']],
  ['Nautical miles (international)', 1852, ['nmi', 'nautical mile', 'nautical miles']],
];
for (const [label, scale, aliases] of lengthUnits) unit('length', label, scale, aliases);
for (const [label, scale, aliases] of lengthUnits.slice(2, 10)) {
  const symbol = aliases[0];
  const words = aliases.slice(1);
  unit('area', `Square ${label.toLowerCase()}`, scale ** 2,
    [`${symbol}²`, `${symbol}2`, `${symbol}^2`, `sq ${symbol}`, ...words.map(word => `square ${word}`)]);
  unit('volume', `Cubic ${label.toLowerCase()}`, scale ** 3,
    [`${symbol}³`, `${symbol}3`, `${symbol}^3`, `cu ${symbol}`, ...words.map(word => `cubic ${word}`)]);
}
unit('area', 'Hectares', 10000, ['ha', 'hectare', 'hectares']);
unit('area', 'Acres (international foot)', 4046.8564224, ['acre', 'acres']);
unit('mass', 'Milligrams', 1e-6, ['mg', 'milligram', 'milligrams']);
unit('mass', 'Grams', 0.001, ['g', 'gram', 'grams']);
unit('mass', 'Kilograms', 1, ['kg', 'kilogram', 'kilograms']);
unit('mass', 'Metric tonnes', 1000, ['t', 'tonne', 'tonnes', 'metric ton', 'metric tons', 'metric tonne', 'metric tonnes']);
unit('mass', 'Ounces (avoirdupois)', 0.028349523125, ['oz', 'ounce', 'ounces']);
unit('mass', 'Pounds (avoirdupois)', 0.45359237, ['lb', 'lbs', 'pound', 'pounds']);
unit('mass', 'Stones (14 avoirdupois pounds)', 6.35029318, ['st', 'stone', 'stones']);
// Temperature uses Celsius as its reference; zero is the source reading at 0°C.
unit('temperature', 'Celsius', 1, ['c', '°c', 'celsius', 'degree celsius', 'degrees celsius']);
unit('temperature', 'Fahrenheit', 5 / 9, ['f', '°f', 'fahrenheit', 'degree fahrenheit', 'degrees fahrenheit'], 32);
unit('temperature', 'Kelvin', 1, ['k', 'kelvin', 'kelvins'], 273.15);
unit('duration', 'Milliseconds', 0.001, ['ms', 'millisecond', 'milliseconds']);
unit('duration', 'Seconds', 1, ['s', 'sec', 'secs', 'second', 'seconds']);
unit('duration', 'Minutes', 60, ['min', 'mins', 'minute', 'minutes']);
unit('duration', 'Hours', 3600, ['h', 'hr', 'hrs', 'hour', 'hours']);
unit('duration', 'Days (24 hours)', 86400, ['d', 'day', 'days']);
unit('duration', 'Weeks (7 days)', 604800, ['wk', 'wks', 'week', 'weeks']);
unit('volume', 'Milliliters', 1e-6, ['ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres']);
unit('volume', 'Centiliters', 1e-5, ['cl', 'centiliter', 'centiliters', 'centilitre', 'centilitres']);
unit('volume', 'Deciliters', 1e-4, ['dl', 'deciliter', 'deciliters', 'decilitre', 'decilitres']);
unit('volume', 'Liters', 0.001, ['l', 'liter', 'liters', 'litre', 'litres']);
// Country-qualified aliases avoid silently selecting among incompatible gallon/cup definitions.
unit('volume', 'US fluid ounces', 0.0000295735295625, ['us fl oz', 'us fluid ounce', 'us fluid ounces']);
unit('volume', 'US cups', 0.0002365882365, ['us cup', 'us cups']);
unit('volume', 'US liquid pints', 0.000473176473, ['us pt', 'us pint', 'us pints', 'us liquid pint', 'us liquid pints']);
unit('volume', 'US liquid quarts', 0.000946352946, ['us qt', 'us quart', 'us quarts', 'us liquid quart', 'us liquid quarts']);
unit('volume', 'US liquid gallons', 0.003785411784, ['us gal', 'us gallon', 'us gallons', 'us liquid gallon', 'us liquid gallons']);
unit('volume', 'Imperial gallons', 0.00454609, ['imperial gal', 'imperial gallon', 'imperial gallons']);

function dataUnit(label, scale, symbols, words) {
  const record = unit('data', label, scale, words);
  for (const symbol of symbols) dataSymbols.set(symbol, record);
}
dataUnit('Bits', 1 / 8, ['b'], ['bit', 'bits']);
dataUnit('Bytes', 1, ['B'], ['byte', 'bytes']);
const decimalPrefixes = [['kilo', 'k', 1e3], ['mega', 'M', 1e6], ['giga', 'G', 1e9], ['tera', 'T', 1e12], ['peta', 'P', 1e15]];
const binaryPrefixes = [['kibi', 'Ki', 1024], ['mebi', 'Mi', 1048576], ['gibi', 'Gi', 1073741824], ['tebi', 'Ti', 1099511627776], ['pebi', 'Pi', 1125899906842624]];
for (const [name, symbol, scale] of [...decimalPrefixes, ...binaryPrefixes]) {
  dataUnit(`${name}bytes`, scale, symbol === 'k' ? ['kB', 'KB'] : [`${symbol}B`], [`${name}byte`, `${name}bytes`]);
  dataUnit(`${name}bits`, scale / 8, symbol === 'k' ? ['kb', 'kbit'] : [`${symbol}b`, `${symbol}bit`], [`${name}bit`, `${name}bits`]);
}
unit('currency', 'US dollars (USD)', 1, ['usd', '$', 'us dollar', 'us dollars']);
unit('currency', 'Euros (EUR)', 1 / 0.85, ['eur', '€', 'euro', 'euros']);
unit('currency', 'Pounds sterling (GBP)', 1 / 0.76, ['gbp', '£', 'pound sterling', 'pounds sterling']);
unit('currency', 'Japanese yen (JPY)', 1 / 112, ['jpy', '¥', 'yen', 'japanese yen']);
const findUnit = text => dataSymbols.get(text.trim()) ?? unitAliases.get(normalizeUnit(text));

function finite(value, message = 'Calculation overflow: result is not finite.') {
  if (!Number.isFinite(value)) throw new Error(message);
  return value === 0 ? 0 : value;
}
const format = value => Number(value.toPrecision(15)).toString();
function answer(kind, query, value, detail, error = null, suffix = '') {
  return { kind, query, value, text: error ?? `${format(value)}${suffix}`, detail, error };
}

function tokenize(expression) {
  const tokens = [];
  let position = 0;
  while (position < expression.length) {
    const character = expression[position];
    if (/\s/u.test(character)) { position += 1; continue; }
    if (tokens.length === TOKEN_LIMIT) throw new Error(`Expressions are limited to ${TOKEN_LIMIT} tokens.`);
    const number = expression.slice(position).match(literal);
    if (number) {
      tokens.push({ type: 'number', value: finite(Number(number[0]), 'Number is outside the finite range.') });
      position += number[0].length;
      continue;
    }
    const word = expression.slice(position).match(/^(sqrt|of)(?![a-z_])/iu);
    if (word) { tokens.push({ type: word[0].toLowerCase() }); position += word[0].length; continue; }
    const type = character === '×' ? '*' : character === '÷' ? '/' : character === '−' ? '-' : character === '√' ? 'sqrt' : character;
    if (!['+', '-', '*', '/', '^', '%', '(', ')', 'sqrt'].includes(type)) {
      throw new Error(`Unexpected character “${character}” in expression.`);
    }
    tokens.push({ type });
    position += 1;
  }
  tokens.push({ type: 'end' });
  return tokens;
}

function calculate(expression) {
  const tokens = tokenize(expression);
  let index = 0, depth = 0;
  const type = () => tokens[index].type;
  function nested(parse) {
    if (depth === DEPTH_LIMIT) throw new Error(`Expressions are limited to ${DEPTH_LIMIT} nested operations.`);
    depth += 1;
    try { return parse(); } finally { depth -= 1; }
  }
  function sum() {
    let value = product();
    while (type() === '+' || type() === '-') {
      const operator = tokens[index++].type, right = product();
      value = finite(operator === '+' ? value + right : value - right);
    }
    return value;
  }
  function product() {
    let value = unary();
    while (type() === '*' || type() === '/' || type() === 'of') {
      const operator = tokens[index++].type, right = unary();
      if (operator === '/' && right === 0) throw new Error('Cannot divide by zero.');
      value = finite(operator === '/' ? value / right : value * right);
    }
    return value;
  }
  // Power binds more tightly than signs; its right operand admits signs and another power.
  function unary() {
    const operator = type();
    if (operator === '+' || operator === '-' || operator === 'sqrt') {
      index += 1;
      const value = nested(unary);
      if (operator === 'sqrt' && value < 0) throw new Error('Square root requires a nonnegative real number.');
      return operator === 'sqrt' ? Math.sqrt(value) : operator === '-' ? finite(-value) : value;
    }
    return power();
  }
  function power() {
    let value = postfix();
    if (type() === '^') {
      index += 1;
      const exponent = nested(unary);
      if (value < 0 && !Number.isInteger(exponent)) throw new Error('A negative base requires an integer exponent for real powers.');
      if (value === 0 && exponent < 0) throw new Error('Cannot raise zero to a negative power.');
      value = finite(value ** exponent);
    }
    return value;
  }
  function postfix() {
    let value = primary();
    while (type() === '%') { index += 1; value /= 100; }
    return value;
  }
  function primary() {
    if (type() === 'number') return tokens[index++].value;
    if (type() === '(') {
      index += 1;
      const value = nested(sum);
      if (type() !== ')') throw new Error('Missing closing parenthesis.');
      index += 1;
      return value;
    }
    throw new Error('Expected a number, square root, or parenthesized expression.');
  }
  const value = sum();
  if (type() !== 'end') throw new Error('Unexpected expression suffix; use explicit multiplication between values.');
  return finite(value);
}

function conversionIntent(text) {
  return /^(?:[$€£¥]|(?:USD|EUR|GBP|JPY)\b|[+−-]?(?:\d|\.\d))/iu.test(text)
    && /\s(?:in|to)(?:\s|$)/iu.test(text);
}
function calculationIntent(text) {
  if (/^(?:sqrt(?![a-z_])|√)/iu.test(text)) return true;
  if (!/^(?:[+−-]\s*)*(?:\d|\.\d|\(|sqrt(?![a-z_])|√)/iu.test(text)) return false;
  return /^[\d\s.eE()+\-−*/×÷^%]+$/u.test(text)
    || /[+*/×÷^%√();=]|\bof\b|[-−]\s/iu.test(text)
    || /^[+−-]\s*(?:\d|\.|\(|sqrt|√)/iu.test(text) || /\d\s*[-−]\s*\d/u.test(text);
}

function convert(text) {
  // Greedy left capture permits the inch alias in “5 in in cm”.
  const parts = text.match(/^(.+)\s+(?:in|to)(?:\s+(.*))?$/iu);
  if (!parts || !parts[2]?.trim()) throw new Error('Enter a quantity, source unit, and target unit using “in” or “to”.');
  const left = parts[1].trim().replace(/−/gu, '-');
  const prefixed = left.match(prefixQuantity);
  const suffixed = left.match(quantity);
  if (!prefixed && !suffixed) throw new Error('Enter one decimal or scientific number and a source unit.');
  const amount = finite(Number(prefixed ? prefixed[2] : suffixed[1]), 'Conversion quantity is outside the finite range.');
  const fromText = prefixed ? prefixed[1] : suffixed[2], toText = parts[2].trim();
  const from = findUnit(fromText), to = findUnit(toText);
  if (!from) throw new Error(`Unknown or ambiguous source unit “${fromText}”.`);
  if (!to) throw new Error(`Unknown or ambiguous target unit “${toText}”.`);
  if (from.category !== to.category) throw new Error(`Incompatible units: ${from.label} (${from.category}) and ${to.label} (${to.category}).`);
  const value = finite(from === to ? amount : from.category === 'temperature'
    ? (amount - from.zero) * (from.scale / to.scale) + to.zero
    : amount * (from.scale / to.scale), 'Conversion overflow: result is not finite.');
  const detail = `${from.category[0].toUpperCase()}${from.category.slice(1)} · ${from.label} → ${to.label}`
    + (from.category === 'currency' ? ` · ${rateDisclosure}` : from.category === 'data' ? ' · SI decimal / IEC binary prefixes; 1 byte = 8 bits.' : '');
  return { value, detail, suffix: ` ${to.label}` };
}

/** Private, deterministic answer cards; ordinary source-search text stays ordinary text. */
export function spotlightAnswer(query) {
  if (typeof query !== 'string') return null;
  const text = (query.length > QUERY_LIMIT ? query.slice(0, QUERY_LIMIT) : query).trim();
  if (!text) return null;
  const shorthand = text.match(prefixConversion);
  const conversion = shorthand ? `${shorthand[1]} ${shorthand[2]} to ${shorthand[3]}` : text;
  const kind = conversionIntent(conversion) ? 'conversion' : calculationIntent(text) ? 'calculation' : null;
  if (!kind) return null;
  const detail = kind === 'calculation' ? calculationDetail : 'Local unit conversion · explicit units required; currency uses fixed fictional rates.';
  if (query.length > QUERY_LIMIT) return answer(kind, query, null, detail, `Queries are limited to ${QUERY_LIMIT} UTF-16 units.`);
  try {
    if (kind === 'calculation') return answer(kind, query, calculate(text), detail);
    const converted = convert(conversion);
    return answer(kind, query, converted.value, converted.detail, null, converted.suffix);
  } catch (error) {
    return answer(kind, query, null, detail, error.message);
  }
}
