// A bounded lexer/Pratt parser. No JavaScript evaluation, coercive property access,
// or host service is involved. Exact rational arithmetic covers decimal + − × ÷.
export const CALCULATOR_ENGINE_LIMITS = Object.freeze({ expression:4096,tokens:512,depth:32,digits:256,exponent:1024 });
export class CalculatorError extends Error { constructor(code,message){super(message);this.code=code;} }
const fail=(code,message)=>{throw new CalculatorError(code,message);};
const abs=n=>n<0n?-n:n;
function gcd(a,b){a=abs(a);b=abs(b);while(b){const r=a%b;a=b;b=r;}return a;}
function bounded(n){if(abs(n).toString().length>256)fail('overflow','The local 256-digit arithmetic limit was exceeded.');return n;}
export function rational(n,d=1n){if(d===0n)fail('division_by_zero','Cannot divide by zero.');if(d<0n){n=-n;d=-d;}const g=gcd(n,d);return {n:bounded(n/g),d:bounded(d/g)};}
export const encodeCalculatorValue=v=>({numerator:v.n.toString(),denominator:v.d.toString()});
export const decodeCalculatorValue=v=>rational(BigInt(v.numerator),BigInt(v.denominator));
export const zeroCalculatorValue=()=>({numerator:'0',denominator:'1'});
export function calculatorDecimal(text){
 const match=/^([+-]?)(\d+(?:\.\d*)?|\.\d+)(?:[eE]([+-]?\d+))?$/u.exec(text);if(!match)fail('syntax','Enter a decimal number.');
 const exponent=Number(match[3]??0),parts=match[2].split('.'),fraction=parts[1]??'',digits=(parts[0]+fraction).replace(/^0+/u,'')||'0';
 if(!Number.isSafeInteger(exponent)||Math.abs(exponent)>256||digits.length>256)fail('overflow','The local decimal range was exceeded.');
 let n=BigInt(digits)*(match[1]==='-'?-1n:1n),d=1n,scale=fraction.length-exponent;if(scale>0)d=10n**BigInt(scale);else n*=10n**BigInt(-scale);return rational(n,d);
}
export function calculatorFormat(value,{places=16,base=10,wordBits=64,grouping=false,programmer=false}={}){
 const v=value.n===undefined?decodeCalculatorValue(value):value;
 if(programmer){const n=v.n/v.d,text=(base===10?n:BigInt.asUintN(wordBits,n)).toString(base).toUpperCase();return grouping&&base===10?text.replace(/\B(?=(\d{3})+(?!\d))/gu,','):text;}
 const negative=v.n<0n,n=abs(v.n),scale=10n**BigInt(places);let scaled=n*scale/v.d;if(n*scale%v.d*2n>=v.d)scaled++;
 const whole=scaled/scale,tail=(scaled%scale).toString().padStart(places,'0').replace(/0+$/u,'');let head=whole.toString();if(grouping)head=head.replace(/\B(?=(\d{3})+(?!\d))/gu,',');const text=head+(tail?'.'+tail:'');return (negative&&scaled?'-':'')+text;
}
export function calculatorExpressionValue(value){const v=value.n===undefined?decodeCalculatorValue(value):value;return v.d===1n?v.n.toString():`(${v.n}/${v.d})`;}
export function calculatorLastOperand(text){let end=text.length;while(end&&/\s/u.test(text[end-1]))end--;if(!end)return {start:0,end:0,text:''};let start=end;if(text[end-1]===')'){let level=1;start--;while(start&&level){start--;if(text[start]===')')level++;if(text[start]==='(')level--;}while(start&&/[a-z]/iu.test(text[start-1]))start--;}else {const match=/(?:0[xob][0-9a-f]+|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[a-f]+|pi|e)$/iu.exec(text.slice(0,end));if(match)start=end-match[0].length;}if(start<end&&text[start-1]==='-'&&(!text.slice(0,start-1).trim()||/[+*/^(\-]$/u.test(text.slice(0,start-1).trim())))start--;return {start,end,text:text.slice(start,end)};}
function floating(v){const result=Number(v.n)/Number(v.d);if(!Number.isFinite(result))fail('overflow','This scientific input is outside the finite local range.');return result;}
function fromFloat(n){if(!Number.isFinite(n))fail(Number.isNaN(n)?'domain':'overflow',Number.isNaN(n)?'The operation is outside its real-number domain.':'The scientific result overflowed.');return calculatorDecimal(n.toPrecision(16));}
const functions=new Set(['sqrt','cbrt','ln','log','exp','sin','cos','tan','asin','acos','atan','sinh','cosh','tanh','abs','floor','ceil','reciprocal','square','cube']);
const bitOperators=new Set(['AND','OR','XOR','<<','>>','>>>','MOD']);
export function calculatorLex(source,{mode='scientific',base=10}={}){
 if(typeof source!=='string'||source.length>4096)fail('limit','The expression exceeds 4096 characters.');
 const text=source.replace(/×/gu,'*').replace(/÷/gu,'/').replace(/[−–]/gu,'-').replace(/π/gu,'pi'),tokens=[];let at=0;
 while(at<text.length){if(/\s/u.test(text[at])){at++;continue;}const start=at,rest=text.slice(at);let match;
 if((match=/^(>>>|<<|>>)/u.exec(rest))){tokens.push({type:'operator',text:match[0],at});at+=match[0].length;}
 else if('+-*/^()%!~&|'.includes(text[at])){const symbol=text[at++];tokens.push({type:symbol==='('? 'open':symbol===')'?'close':'operator',text:symbol==='&'?'AND':symbol==='|'?'OR':symbol==='~'?'NOT':symbol,at:start});}
 else if(mode==='programmer'&&(match=/^(0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO][0-7]+)/u.exec(rest))){tokens.push({type:'integer',text:match[0],at});at+=match[0].length;}
 else if(mode==='programmer'&&(match=/^(AND|OR|XOR|NOT|MOD)\b/iu.exec(rest))){tokens.push({type:'operator',text:match[0].toUpperCase(),at});at+=match[0].length;}
 else if(mode==='programmer'&&(match=(base===16?/^[0-9a-fA-F]+/u:base===8?/^[0-7]+/u:base===2?/^[01]+/u:/^\d+/u).exec(rest))){let n=0n;for(const digit of match[0])n=n*BigInt(base)+BigInt(parseInt(digit,16));tokens.push({type:'integer',text:n.toString(),at});at+=match[0].length;}
 else if(mode!=='programmer'&&(match=/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/u.exec(rest))){tokens.push({type:'number',text:match[0],at});at+=match[0].length;}
 else if(mode!=='programmer'&&(match=/^[a-z]+/iu.exec(rest))){const name=match[0].toLowerCase();if(name!=='pi'&&name!=='e'&&!functions.has(name))fail('syntax',`Unknown calculator function “${match[0]}”.`);if(mode==='basic')fail('mode','Scientific functions require Scientific mode.');tokens.push({type:name==='pi'||name==='e'?'constant':'function',text:name,at});at+=match[0].length;}
 else fail('syntax',`Invalid input at character ${at+1}.`);
 if(tokens.length>512)fail('limit','The expression exceeds 512 tokens.');
 }
 tokens.push({type:'end',text:'',at});return tokens;
}
export function calculatorUnary(name,value,{angle='degrees',mode='scientific',wordBits=64}={}){
 const v=value.n===undefined?decodeCalculatorValue(value):value;
 if(name==='sign')return rational(-v.n,v.d);
 if(name==='percent')return rational(v.n,v.d*100n);
 if(name==='reciprocal')return rational(v.d,v.n);
 if(name==='square')return rational(v.n*v.n,v.d*v.d);
 if(name==='cube')return rational(v.n*v.n*v.n,v.d*v.d*v.d);
 if(name==='NOT')return rational(BigInt.asIntN(wordBits,~(v.n/v.d)));
 if(name==='factorial'){if(v.d!==1n||v.n<0n)fail('domain','Factorial requires a nonnegative integer.');if(v.n>170n)fail('overflow','Factorial exceeds the local 256-digit limit.');let n=1n;for(let i=2n;i<=v.n;i++)n*=i;return rational(n);}
 const x=floating(v),r=angle==='degrees'?Math.PI/180:1;let result;
 if((name==='ln'||name==='log')&&x<=0)fail('domain','Logarithms require a positive real value.');
 if(name==='sqrt')result=Math.sqrt(x);else if(name==='cbrt')result=Math.cbrt(x);else if(name==='ln')result=Math.log(x);else if(name==='log')result=Math.log10(x);else if(name==='exp')result=Math.exp(x);else if(name==='sin'||name==='cos')result=Math[name](x*r);else if(name==='tan'){if(Math.abs(Math.cos(x*r))<1e-14)fail('domain','Tangent is undefined at this angle.');result=Math.tan(x*r);}else if(['asin','acos','atan'].includes(name))result=Math[name](x)/r;else if(['sinh','cosh','tanh','abs','floor','ceil'].includes(name))result=Math[name](x);else fail('syntax','Unknown unary operation.');
 const output=fromFloat(result);return mode==='programmer'?rational(output.n/output.d):output;
}
export function calculatorBinary(op,a,b,{mode='scientific',wordBits=64}={}){
 let result;
 if(op==='+')result=rational(a.n*b.d+b.n*a.d,a.d*b.d);else if(op==='-')result=rational(a.n*b.d-b.n*a.d,a.d*b.d);else if(op==='*')result=rational(a.n*b.n,a.d*b.d);else if(op==='/')result=rational(a.n*b.d,a.d*b.n);
 else if(op==='^'){if(b.d===1n){if(abs(b.n)>1024n)fail('overflow','Power exceeds the local exponent limit.');const exponent=abs(b.n);if([abs(a.n),a.d].some(n=>n>1n&&Number(exponent)*Math.log10(Number(n))>=256))fail('overflow','The power exceeds the local 256-digit arithmetic limit.');result=b.n<0n?rational(a.d**exponent,a.n**exponent):rational(a.n**exponent,a.d**exponent);}else result=fromFloat(Math.pow(floating(a),floating(b)));}
 else if(bitOperators.has(op)||op==='%'){
  if(mode!=='programmer')fail('mode','Bitwise operations require Programmer mode.');const x=a.n/a.d,y=b.n/b.d;
  if(op==='MOD'||op==='%'){if(y===0n)fail('division_by_zero','Cannot take a remainder by zero.');result=rational(x%y);}
  else if(op==='AND')result=rational(BigInt.asIntN(wordBits,x&y));else if(op==='OR')result=rational(BigInt.asIntN(wordBits,x|y));else if(op==='XOR')result=rational(BigInt.asIntN(wordBits,x^y));
  else {if(y<0n||y>=BigInt(wordBits))fail('domain','Shift count must be within the selected word size.');result=rational(op==='<<'?BigInt.asIntN(wordBits,x<<y):op==='>>'?BigInt.asIntN(wordBits,x)>>y:BigInt.asUintN(wordBits,x)>>y);}
 }else fail('syntax','Unknown binary operation.');
 return mode==='programmer'?rational(BigInt.asIntN(wordBits,result.n/result.d)):result;
}
export function evaluateCalculator(source,options={}){
 const opts={mode:'scientific',base:10,wordBits:64,angle:'degrees',immediate:false,...options},tokens=calculatorLex(source,opts);let index=0,repeat=null;
 const precedence=op=>opts.immediate&&['+','-','*','/'].includes(op)?40:({OR:10,XOR:15,AND:20,'<<':30,'>>':30,'>>>':30,'+':40,'-':40,'*':50,'/':50,MOD:50,'%':50,'^':70})[op];
 function expression(min=0,depth=0){if(depth>32)fail('limit','Parentheses exceed the local nesting limit.');let token=tokens[index++],left;
  if(token.type==='number')left=calculatorDecimal(token.text);else if(token.type==='integer')left=rational(BigInt(token.text));else if(token.type==='constant')left=fromFloat(token.text==='pi'?Math.PI:Math.E);
  else if(token.type==='open'){left=expression(0,depth+1);if(tokens[index++].type!=='close')fail('syntax','Close the parenthesis.');}
  else if(token.type==='function'){left=calculatorUnary(token.text,expression(80,depth+1),opts);}
  else if(token.type==='operator'&&['+','-','NOT'].includes(token.text)){if(token.text==='NOT'&&opts.mode!=='programmer')fail('mode','NOT requires Programmer mode.');left=expression(60,depth+1);if(token.text==='-')left=rational(-left.n,left.d);if(token.text==='NOT')left=calculatorUnary('NOT',left,opts);}
  else fail('syntax',`Expected a number at character ${token.at+1}.`);
  for(;;){const next=tokens[index];if(next.type!=='operator')break;
   if(next.text==='!'||next.text==='%'&&opts.mode!=='programmer'){if(80<min)break;if(next.text==='!'&&opts.mode!=='scientific')fail('mode','Factorial requires Scientific mode.');index++;left=calculatorUnary(next.text==='!'?'factorial':'percent',left,opts);continue;}
   const rank=precedence(next.text);if(rank===undefined||rank<min)break;if(next.text==='^'&&opts.mode!=='scientific')fail('mode','Powers require Scientific mode.');index++;const right=expression(rank+(next.text==='^'?0:1),depth+1);left=calculatorBinary(next.text,left,right,opts);repeat={operator:next.text,value:encodeCalculatorValue(right)};
  }return left;
 }
 if(tokens.length===1)fail('syntax','Enter a calculation first.');let value=expression();if(tokens[index].type!=='end')fail('syntax',`Unexpected input at character ${tokens[index].at+1}.`);if(opts.mode==='programmer')value=rational(BigInt.asIntN(opts.wordBits,value.n/value.d));return {value:encodeCalculatorValue(value),repeat};
}
