import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateCalculator,calculatorLex,calculatorFormat,calculatorDecimal,encodeCalculatorValue,calculatorUnary,calculatorBinary,CalculatorError} from '../frontend/src/calculator-engine.js';
import {calculatorConvert,CALCULATOR_FIXED_RATES} from '../frontend/src/calculator-conversion.js';
const value=(text,options)=>evaluateCalculator(text,options).value;
const formatted=(text,options)=>calculatorFormat(value(text,options),{places:16});
test('decimal arithmetic retains exact rational values rather than binary-float tails',()=>{
 assert.equal(formatted('0.1+0.2'),'0.3');assert.deepEqual(value('1/3+1/6'),{numerator:'1',denominator:'2'});assert.deepEqual(value('100000000000000000001-100000000000000000000'),{numerator:'1',denominator:'1'});assert.equal(formatted('3e-4+2e-4'),'0.0005');
});
test('precedence, parentheses, right-associative powers and unary signs are actual parser behavior',()=>{
 assert.equal(formatted('2+3*4'),'14');assert.equal(formatted('(2+3)*4'),'20');assert.equal(formatted('2^3^2'),'512');assert.equal(formatted('-2^2'),'-4');assert.equal(formatted('(-2)^2'),'4');assert.equal(formatted('2^-3'),'0.125');assert.equal(formatted('4×3−2÷2'),'11');assert.equal(formatted('2+3*4',{mode:'basic',immediate:true}),'20');
});
test('scientific trig respects angle units and real-domain errors',()=>{
 assert.ok(Math.abs(Number(formatted('sin(30)'))-.5)<1e-14);assert.ok(Math.abs(Number(formatted('cos(pi)',{angle:'radians'}))+1)<1e-14);assert.equal(formatted('sqrt(81)+5!'),'129');assert.equal(formatted('ln(e)'),'1');assert.throws(()=>value('sqrt(-1)'),error=>error.code==='domain');assert.throws(()=>value('tan(90)'),error=>error.code==='domain');assert.throws(()=>value('(-3)!'),error=>error.code==='domain');assert.throws(()=>value('1/0'),error=>error.code==='division_by_zero');assert.throws(()=>value('exp(1000)'),error=>error.code==='overflow');
});
test('closed lexer rejects executable syntax, implicit concatenation and incomplete expressions',()=>{
 for(const text of ['globalThis.alert(1)','1;2','constructor','1,000','1 2','2(3)','1e','2+','(3','3)'])assert.throws(()=>value(text),CalculatorError,text);
 assert.throws(()=>calculatorLex('1'.repeat(4097)),error=>error.code==='limit');assert.throws(()=>value('('.repeat(40)+'1'+')'.repeat(40)),error=>error.code==='limit');assert.throws(()=>value('9'.repeat(256)+'^1024'),error=>error.code==='overflow');assert.throws(()=>value('sin(2)',{mode:'basic'}),error=>error.code==='mode');
});
test('programmer arithmetic uses real radix values, signed selected words and integer division',()=>{
 const opts={mode:'programmer',base:16,wordBits:8};assert.deepEqual(value('FF',opts),{numerator:'-1',denominator:'1'});assert.equal(calculatorFormat(value('0xFF AND 0x0F',opts),{programmer:true,base:16,wordBits:8}),'F');assert.deepEqual(value('99/10',{mode:'programmer',base:10}),{numerator:'9',denominator:'1'});assert.deepEqual(value('127+1',{mode:'programmer',wordBits:8}),{numerator:'-128',denominator:'1'});assert.deepEqual(value('NOT 0',{mode:'programmer',wordBits:16}),{numerator:'-1',denominator:'1'});assert.deepEqual(value('0b1010 XOR 0b0011',{mode:'programmer',base:2}),{numerator:'9',denominator:'1'});assert.deepEqual(value('-8 >> 2',{mode:'programmer'}),{numerator:'-2',denominator:'1'});assert.throws(()=>value('1 << 8',{mode:'programmer',wordBits:8}),error=>error.code==='domain');assert.throws(()=>value('2',{mode:'programmer',base:2}),error=>error.code==='syntax');assert.throws(()=>value('1.5',{mode:'programmer'}),error=>error.code==='syntax');
});
test('decimal-place display rounds without changing canonical precision or grouping fractional digits',()=>{
 const v=value('12345.678901');assert.equal(calculatorFormat(v,{places:2,grouping:true}),'12,345.68');assert.equal(calculatorFormat(v,{places:6,grouping:true}),'12,345.678901');assert.equal(calculatorFormat(value('99/10'),{places:0}),'10');assert.deepEqual(v,{numerator:'12345678901',denominator:'1000000'});
});
test('conversions compute SI scaling, exact affine temperatures, reverse rates and absolute zero',()=>{
 const convert=(input,category,from,to)=>calculatorConvert(encodeCalculatorValue(calculatorDecimal(input)),category,from,to,CALCULATOR_FIXED_RATES);
 assert.equal(calculatorFormat(convert('1','length','mi','ft')),'5280');assert.equal(calculatorFormat(convert('32','temperature','F','C')),'0');assert.equal(calculatorFormat(convert('100','temperature','C','F')),'212');assert.equal(calculatorFormat(convert('36','speed','kph','mps')),'10');assert.equal(calculatorFormat(convert('2','mass','lb','kg')),'0.90718474');assert.equal(calculatorFormat(convert('100','currency','USD','EUR')),'92');assert.equal(calculatorFormat(convert('92','currency','EUR','USD')),'100');assert.equal(calculatorFormat(convert('1','energy','kWh','J')),'3600000');assert.throws(()=>convert('-274','temperature','C','K'),error=>error.code==='domain');assert.throws(()=>convert('1','length','m','kg'),error=>error.code==='unit');
});
