import {copyCanonicalData,applyCanonicalData} from './canonical-data.js';
import {calculatorCommandSpecs,calculatorTargetSchema} from './calculator-catalog.js';
import {calculatorWindow,createCalculatorWindow,validateCalculatorState,calculatorSchemaValid,calculatorTextUnits,calculatorCapabilities,calculatorWindowMetadata,calculatorIdSchema} from './calculator-state.js';
import {evaluateCalculator,calculatorLex,calculatorFormat,calculatorExpressionValue,calculatorBinary,calculatorUnary,calculatorLastOperand as lastOperand,encodeCalculatorValue,decodeCalculatorValue,zeroCalculatorValue,rational,CalculatorError} from './calculator-engine.js';
import {CALCULATOR_UNITS,calculatorConvert} from './calculator-conversion.js';
const rejected=(code,message)=>({status:'rejected',error:{code,message}}),applied=(windowId,extra={})=>({status:'applied',target:{windowId},...extra});
const binary=new Set(['+','-','*','/','^','AND','OR','XOR','MOD','<<','>>','>>>']);
const unary=new Set(['sign','sqrt','cbrt','reciprocal','square','cube','ln','log','exp','sin','cos','tan','asin','acos','atan','sinh','cosh','tanh','abs','floor','ceil','NOT','!','%']);
function objectIdentities(value,path=[],out=[]){if(value&&typeof value==='object'){out.push([path,value]);for(const key of Object.keys(value))objectIdentities(value[key],[...path,key],out);}return out;}
export function createCalculatorCommands(state,ctx){
 let generation=0,disposed=false;const originalWindows=new Map();
 const profileId=typeof ctx.profile==='string'?ctx.profile:ctx.profile.id;
 const alive=()=>!disposed&&ctx.alive()===true&&(!ctx.getState||ctx.getState()===state)&&state.profileId===profileId;
 const authoredTime=()=>ctx.getSceneTime?.()??state.rateTime;
 const owns=window=>typeof ctx.ownsApp==='function'?ctx.ownsApp(window,'calculator')===true:['calculator','local-calculator','local-radix-lab'].includes(window?.appId);
 const stale=()=>rejected('stale_target','The original Calculator graph, row, window, view or authored time changed.');
 const unavailable=message=>rejected('unavailable',message);
 function lease(windowId,native=false){
  if(!alive()||!validateCalculatorState(state,ctx.profile).ok)return null;
  const window=ctx.getWindow(windowId),session=calculatorWindow(state,windowId),view=ctx.getView?.(windowId);if(!window||!session||!owns(window)||session.appId!==window.appId||originalWindows.has(windowId)&&originalWindows.get(windowId)!==window||ctx.available(window)!==true||native&&(!view||view.available()!==true))return null;
  const version=generation,signature=JSON.stringify(state),windowSignature=JSON.stringify(window),time=authoredTime(),identities=objectIdentities(state);
  const guard=()=>alive()&&generation===version&&validateCalculatorState(state,ctx.profile).ok&&authoredTime()===time&&ctx.getWindow(windowId)===window&&owns(window)&&JSON.stringify(window)===windowSignature&&calculatorWindow(state,windowId)===session&&ctx.getView?.(windowId)===view&&ctx.available(window)===true&&(!native||view.available()===true)&&JSON.stringify(state)===signature&&identities.every(([path,original])=>path.reduce((node,key)=>node?.[key],state)===original);
  return {windowId,window,session,view,time,guard};
 }
 const options=w=>({mode:w.mode,base:w.base,wordBits:w.wordBits,angle:w.angle,immediate:profileId.startsWith('windows11')&&w.mode==='basic'});
 const literal=(value,w)=>{const v=value.n===undefined?decodeCalculatorValue(value):value;if(w.mode!=='programmer'||w.base===10)return calculatorExpressionValue(v);const n=v.n/v.d;return n<0n?`(-0x${(-n).toString(16)})`:`0x${n.toString(16)}`;};
 function prepare(owner,mutation){
  if(!owner.guard())return {error:stale()};const candidate=copyCanonicalData(state),w=calculatorWindow(candidate,owner.windowId);let extra;
  try{extra=mutation(candidate,w)??{};}catch(error){return {error:rejected(error.code??'invalid_arguments',error.message??'Calculator input is unavailable.')};}
  if(extra.status==='rejected')return {error:extra};w.revision++;const valid=validateCalculatorState(candidate,ctx.profile),delta=calculatorTextUnits(candidate)-calculatorTextUnits(state);
  if(!valid.ok)return {error:rejected('invalid_state',valid.message)};if(ctx.canCommit(delta)!==true)return {error:rejected('limit_exceeded','The combined scene retention budget would be exceeded.')};return {candidate,delta,extra};
 }
 function publish(candidate){applyCanonicalData(state,candidate);generation++;}
 function commit(owner,mutation){const p=prepare(owner,mutation);if(p.error)return p.error;if(!owner.guard())return stale();publish(p.candidate);return applied(owner.windowId,p.extra);}
 function rowId(c,prefix){if(c.nextId>=Number.MAX_SAFE_INTEGER-1)throw new CalculatorError('limit','Calculator row IDs are exhausted.');return `${prefix}-${c.nextId++}`;}
 function record(c,w,expression,value,time){if(w.tape.length>=128)w.tape.shift();w.tape.push({id:rowId(c,'calculation'),expression,value:copyCanonicalData(value),mode:w.mode,base:w.base,wordBits:w.wordBits,at:time});}
 function clear(w){w.expression='';w.value=zeroCalculatorValue();w.completed=false;w.error=null;w.repeat=null;w.status='';}
 function result(w,value){w.value=value;w.completed=true;w.error=null;}
 function current(w){if(w.completed||!w.expression)return decodeCalculatorValue(w.value);const operand=w.rpn?w.expression:lastOperand(w.expression).text;return operand?decodeCalculatorValue(evaluateCalculator(operand,options(w)).value):decodeCalculatorValue(w.value);}
 function calculate(c,w,time){
  if(w.rpn){stackOperation(c,w,'enter',time);return;}
  const source=w.completed?w.repeat?`${literal(w.value,w)} ${w.repeat.operator} ${literal(w.repeat.value,w)}`:literal(w.value,w):w.expression||literal(w.value,w);
  try{const output=evaluateCalculator(source,options(w));result(w,output.value);w.repeat=output.repeat;w.expression=source;record(c,w,source,output.value,time);}catch(error){w.error={code:error.code??'syntax',message:String(error.message).slice(0,256)};w.completed=false;w.repeat=null;}
 }
 function stackOperation(c,w,operation,time){
  if(!w.rpn)throw new CalculatorError('mode','Enable RPN Mode first.');
  if(operation==='clear'){w.stack.splice(0);w.value=zeroCalculatorValue();w.expression='';w.completed=true;return;}if(operation==='drop'){if(!w.stack.length)throw new CalculatorError('disabled','The RPN stack is empty.');w.stack.pop();w.value=copyCanonicalData(w.stack[w.stack.length-1]??zeroCalculatorValue());w.expression='';w.completed=true;return;}
  if(operation==='enter'){if(w.stack.length>=32)throw new CalculatorError('limit','The local RPN stack holds at most 32 values.');const value=encodeCalculatorValue(current(w));w.stack.push(value);result(w,value);w.expression='';w.repeat=null;return;}
  if(w.stack.length<2)throw new CalculatorError('disabled','At least two RPN stack values are required.');if(operation==='swap'){const n=w.stack.length;[w.stack[n-1],w.stack[n-2]]=[w.stack[n-2],w.stack[n-1]];}else if(operation==='up')w.stack.unshift(w.stack.pop());else if(operation==='down')w.stack.push(w.stack.shift());w.value=copyCanonicalData(w.stack[w.stack.length-1]);w.completed=true;
 }
 function key(c,w,key,time){
  w.status='';if(key==='clear'){clear(w);return;}if(key==='clearEntry'){const span=lastOperand(w.expression);w.expression=w.expression.slice(0,span.start);w.value=zeroCalculatorValue();w.error=null;w.completed=false;w.repeat=null;return;}
  if(w.error){if(/^[0-9A-F.]$/u.test(key)){clear(w);}else throw new CalculatorError('error','Clear the arithmetic error before continuing.');}
  if(key==='equals'){calculate(c,w,time);return;}
  if(key==='backspace'){if(w.completed){clear(w);return;}w.expression=w.expression.slice(0,-1);return;}
  if(w.rpn&&binary.has(key)){
   const hasInput=!w.completed&&!!w.expression,need=hasInput?1:2;if(w.stack.length<need)throw new CalculatorError('disabled','The RPN stack needs two operands.');
   const b=hasInput?current(w):decodeCalculatorValue(w.stack.pop()),a=decodeCalculatorValue(w.stack.pop()),v=encodeCalculatorValue(calculatorBinary(key,a,b,options(w)));w.stack.push(v);result(w,v);w.expression='';record(c,w,`${calculatorExpressionValue(a)} ${key} ${calculatorExpressionValue(b)}`,v,time);return;
  }
  if(binary.has(key)){
   if(w.mode==='scientific'&&['+','-'].includes(key)&&/(?:\d+(?:\.\d*)?|\.\d+)[eE]$/u.test(w.expression)){w.expression+=key;return;}
   if(['^'].includes(key)&&w.mode!=='scientific'||['AND','OR','XOR','MOD','<<','>>','>>>'].includes(key)&&w.mode!=='programmer')throw new CalculatorError('mode','Choose the calculator mode for this operator.');
   if(w.completed){w.expression=literal(w.value,w);w.completed=false;w.repeat=null;}if(!w.expression)w.expression=literal(w.value,w);
   const trailing=/\s*(?:AND|OR|XOR|MOD|>>>|<<|>>|[+*/^\-])\s*$/u.exec(w.expression);if(trailing&&key!=='-')w.expression=w.expression.slice(0,trailing.index);else if(w.expression&&!trailing){const source=options(w).immediate?w.expression:lastOperand(w.expression).text;const output=evaluateCalculator(source||literal(w.value,w),options(w));w.value=output.value;}
   w.expression+=` ${key} `;return;
  }
  if(unary.has(key)){
   if(key==='NOT'&&w.mode!=='programmer')throw new CalculatorError('mode','NOT requires Programmer mode.');if(w.mode==='basic'&&!['sign','%','reciprocal','square','sqrt'].includes(key))throw new CalculatorError('mode','This function requires Scientific or Programmer mode.');if(w.mode==='programmer'&&!['sign','NOT'].includes(key))throw new CalculatorError('mode','Programmer mode accepts integer and bitwise operations.');
   const span=lastOperand(w.expression),input=w.completed||!span.text?decodeCalculatorValue(w.value):decodeCalculatorValue(evaluateCalculator(span.text,options(w)).value);let output;
   try{output=calculatorUnary(key==='!'?'factorial':key==='%'?'percent':key,input,options(w));
    if(key==='%'&&!w.completed){const prefix=w.expression.slice(0,span.start),match=/^(.*)\s([+-])\s*$/u.exec(prefix);if(match)output=calculatorBinary('*',decodeCalculatorValue(evaluateCalculator(match[1],options(w)).value),output,options(w));}
    const encoded=encodeCalculatorValue(output);if(w.rpn&&w.completed&&w.stack.length){w.stack[w.stack.length-1]=copyCanonicalData(encoded);w.expression='';w.value=encoded;}else {w.expression=w.completed||!span.text?literal(output,w):w.expression.slice(0,span.start)+literal(output,w)+w.expression.slice(span.end);w.value=encoded;w.completed=false;}w.repeat=null;
   }catch(error){w.error={code:error.code??'domain',message:String(error.message).slice(0,256)};w.repeat=null;}return;
  }
  if(key==='EE'){if(w.mode!=='scientific')throw new CalculatorError('mode','Exponential notation requires Scientific mode.');if(w.completed){w.expression=calculatorExpressionValue(w.value);w.completed=false;}const operand=lastOperand(w.expression).text;if(!/\d$/u.test(w.expression)||/[eE]/u.test(operand))throw new CalculatorError('syntax','Enter a mantissa without an exponent before EE.');w.value=evaluateCalculator(operand,options(w)).value;w.expression+='e';return;}
  if(key==='pi'||key==='e'){if(w.mode!=='scientific')throw new CalculatorError('mode','Constants require Scientific mode.');w.value=evaluateCalculator(key,options(w)).value;}
  if(w.completed){w.expression='';w.completed=false;w.repeat=null;}
  if(w.mode==='programmer'&&key==='.'){throw new CalculatorError('mode','Programmer mode uses integers.');}
  if(/^[A-F]$/u.test(key)&&!(w.mode==='programmer'&&w.base===16))throw new CalculatorError('mode','Hexadecimal digits require base16 Programmer mode.');
  if(/^\d$/u.test(key)&&w.mode==='programmer'&&Number(key)>=w.base)throw new CalculatorError('digit','This digit is not available in the selected base.');
  if(key==='.'&&(/\.[0-9]*$/u.test(w.expression)||/[eE]/u.test(lastOperand(w.expression).text)))return;
  w.expression+=key;
 }
 async function clipboard(owner,operation){
  const ownership={guard:owner.guard,windowId:owner.windowId};
  if(operation==='paste'){
   if(typeof ctx.getClipboard!=='function')return unavailable('The actual scene clipboard reader is unavailable.');
   const pending=ctx.getClipboard(ownership),synchronous=!(pending&&typeof pending.then==='function'),source=synchronous?(pending?.clipboard??pending):null,sourceSignature=synchronous?JSON.stringify(source):null;
   const read=await pending;if(!owner.guard())return stale();if(read?.status==='rejected')return read;const original=read?.clipboard??read,text=typeof original==='string'?original:original?.text;if(typeof text!=='string'||original?.kind&&original.kind!=='text')return rejected('unsupported_content','Paste requires actual scene text clipboard content.');
   const signature=JSON.stringify(original),guard=()=>{if(!owner.guard()||JSON.stringify(original)!==signature)return false;if(!synchronous)return true;const now=ctx.getClipboard(ownership),actual=now?.clipboard??now;return actual===source&&JSON.stringify(actual)===sourceSignature;};
   if(text.length>4096)return rejected('limit_exceeded','Pasted expressions are limited to 4096 characters.');try{calculatorLex(text,options(owner.session));}catch(error){return rejected(error.code,error.message);}if(!guard())return stale();return commit({...owner,guard},(_,w)=>{w.expression=text;w.error=null;w.completed=false;w.repeat=null;});
  }
  if(typeof ctx.setClipboard!=='function')return unavailable('The atomic scene clipboard writer is unavailable.');if(owner.session.error&&operation==='copy')return rejected('disabled','An arithmetic error is not a numeric result.');
  const text=operation==='copyTape'?owner.session.tape.map(row=>`${row.expression} = ${calculatorFormat(row.value,{places:32,programmer:row.mode==='programmer',base:row.base,wordBits:row.wordBits})}`).join('\n'):calculatorFormat(encodeCalculatorValue(current(owner.session)),{places:32,programmer:owner.session.mode==='programmer',base:owner.session.base,wordBits:owner.session.wordBits});
  if(operation==='copyTape'&&!text)return rejected('disabled','There are no genuine paper tape entries to copy.');
  const prepared=prepare(owner,(_,w)=>{w.status=operation==='copyTape'?'Paper tape copied to the scene clipboard.':'Result copied to the scene clipboard.';});if(prepared.error)return prepared.error;let acknowledged=false;
  const result=await ctx.setClipboard({text,reserveTextUnits:prepared.delta,onCommit:()=>{if(acknowledged||!owner.guard()||ctx.canCommit(prepared.delta)!==true||!validateCalculatorState(prepared.candidate,ctx.profile).ok)return false;publish(prepared.candidate);acknowledged=true;return true;}},ownership);
  if(acknowledged)return applied(owner.windowId,{copied:true,presentationAvailable:alive()&&ctx.getWindow(owner.windowId)===owner.window&&ctx.available(owner.window)===true});return owner.guard()?result?.status==='rejected'?result:unavailable('Clipboard did not atomically acknowledge the real text.'):stale();
 }
 const handlers={};for(const [suffix,[schema]] of Object.entries(calculatorCommandSpecs))handlers[`calculator.${suffix}`]=async(target,payload={})=>{
  if(!calculatorSchemaValid(target,calculatorTargetSchema)||!calculatorSchemaValid(payload,schema))return rejected('invalid_arguments','Use the closed Calculator command schema.');const owner=lease(target.windowId,['focus','scroll'].includes(suffix));if(!owner)return unavailable('The original Calculator window, session or required native view is unavailable.');
  try{
   if(suffix==='clipboard')return await clipboard(owner,payload.operation);
   if(suffix==='window.close'){if(!ctx.closeWindow)return unavailable('The guarded native shell close endpoint is unavailable.');const response=await ctx.closeWindow(owner.windowId,{guard:owner.guard,isCurrent:owner.guard,windowId:owner.windowId});return response?.status==='applied'||!ctx.getWindow(owner.windowId)&&!calculatorWindow(state,owner.windowId)?applied(owner.windowId):owner.guard()?response?.status==='rejected'?response:unavailable('The shell did not close the original calculator window.'):stale();}
   if(suffix==='window.new'){if(!ctx.createWindow)return unavailable('The guarded native window creation endpoint is unavailable.');const id=await ctx.createWindow(owner.session.appId,{...calculatorWindowMetadata(ctx.profile,{appId:owner.session.appId,mode:payload.mode??owner.session.mode}),mode:payload.mode??owner.session.mode,isCurrent:owner.guard,sourceGuard:owner.guard});return calculatorSchemaValid(id,calculatorIdSchema)?applied(owner.windowId,{createdWindowId:id}):owner.guard()?unavailable('The shell did not acknowledge an actual independent calculator window.'):stale();}
   if(suffix==='focus'){const focused=await owner.view.focus(payload.controlId,owner.guard);if(!owner.guard())return stale();return focused?applied(owner.windowId):unavailable('The original enabled native calculator control is unavailable.');}
   if(suffix==='scroll'){const response=await owner.view.scroll(payload,owner.guard);if(!owner.guard())return stale();const offsets=owner.view.describe?.().scroll;if(!response||!offsets)return unavailable('The native tape did not acknowledge actual offsets.');return commit(owner,(_,w)=>{w.scroll={top:offsets.top,left:offsets.left};});}
   return commit(owner,(c,w)=>{
    const rowId=payload.rowId??target.rowId;
    if(suffix==='key'){key(c,w,payload.key,owner.time);return;}
    if(suffix==='expression'){w.expression=payload.text;w.completed=false;w.error=null;w.repeat=null;return;}
    if(suffix==='evaluate'){calculate(c,w,owner.time);return;}
    if(suffix==='mode'){clear(w);w.mode=payload.mode;w.second=false;w.stack.splice(0);w.rpn=false;if(w.mode==='programmer')w.conversion.enabled=false;return;}
    if(suffix==='settings'){
     if(payload.second!==undefined&&w.mode!=='scientific')throw new CalculatorError('mode','Second functions require Scientific mode.');
     for(const name of ['angle','base','wordBits','places','grouping','second','rpn'])if(Object.hasOwn(payload,name))w[name]=payload[name];
     if(w.rpn){w.conversion.enabled=false;w.repeat=null;}if(w.mode==='programmer'){w.value=encodeCalculatorValue(rational(BigInt.asIntN(w.wordBits,BigInt(w.value.numerator)/BigInt(w.value.denominator))));w.expression='';w.completed=true;w.error=null;}return;
    }
    if(suffix==='panel'){w.panel=payload.panel;return;}
    if(suffix==='sheet'){if(Object.hasOwn(payload,'sheet'))w.sheet=payload.sheet;if(Object.hasOwn(payload,'menu'))w.menu=payload.menu;return;}
    if(suffix==='stack'){stackOperation(c,w,payload.operation,owner.time);return;}
    if(suffix==='memory'){
     const selected=rowId?w.memory.find(m=>m.id===rowId):w.memory[0];if(rowId&&!selected)throw new CalculatorError('stale_target','The original memory row is unavailable.');
     if(payload.operation==='clear'){w.memory.splice(0);return;}if(payload.operation==='delete'){if(!selected)throw new CalculatorError('disabled','Memory is empty.');w.memory.splice(w.memory.indexOf(selected),1);return;}
     if(payload.operation==='recall'){if(!selected)throw new CalculatorError('disabled','Memory is empty.');w.value=copyCanonicalData(selected.value);if(w.mode==='programmer')w.value=encodeCalculatorValue(rational(BigInt.asIntN(w.wordBits,BigInt(w.value.numerator)/BigInt(w.value.denominator))));const span=lastOperand(w.expression);w.expression=w.completed?literal(w.value,w):!span.text?w.expression+literal(w.value,w):w.expression.slice(0,span.start)+literal(w.value,w);w.completed=false;w.error=null;w.repeat=null;return;}
     if(w.error)throw new CalculatorError('disabled','An arithmetic error cannot be stored.');const value=current(w);
     if(payload.operation==='store'||!selected){if(w.memory.length>=16)throw new CalculatorError('limit','This window holds at most16 memory values.');w.memory.unshift({id:rowIdForMemory(c),value:encodeCalculatorValue(value)});}else selected.value=encodeCalculatorValue(calculatorBinary(payload.operation==='add'?'+':'-',decodeCalculatorValue(selected.value),value,options(w)));return;
    }
    if(suffix==='tape'){
     if(payload.operation==='show'||payload.operation==='hide'){w.panel=payload.operation==='show'?'tape':'none';return;}if(payload.operation==='clear'){w.tape.splice(0);return;}
     const row=w.tape.find(t=>t.id===rowId);if(!row)throw new CalculatorError('stale_target','The original paper tape row is unavailable.');w.mode=row.mode;w.base=row.base;w.wordBits=row.wordBits;w.value=copyCanonicalData(row.value);w.expression=row.expression;w.completed=true;w.error=null;w.repeat=null;w.second=false;if(w.mode==='programmer')w.conversion.enabled=false;return;
    }
    if(suffix==='conversion'){
     if(w.mode==='programmer'||w.rpn)throw new CalculatorError('mode','Conversion requires non-RPN Basic or Scientific mode.');
     if(payload.category!==undefined){const units=CALCULATOR_UNITS[payload.category];w.conversion.category=payload.category;w.conversion.from=units[0].id;w.conversion.to=units[1].id;}
     for(const name of ['enabled','from','to','input'])if(Object.hasOwn(payload,name))w.conversion[name]=payload[name];if(payload.swap)[w.conversion.from,w.conversion.to]=[w.conversion.to,w.conversion.from];return;
    }
    if(suffix==='convert'){
     if(!w.conversion.enabled||w.rpn||w.mode==='programmer')throw new CalculatorError('disabled','Enable unit conversion in Basic or Scientific mode first.');
     try{const source=w.conversion.input?evaluateCalculator(w.conversion.input,{...options(w),base:10}).value:encodeCalculatorValue(current(w)),value=calculatorConvert(source,w.conversion.category,w.conversion.from,w.conversion.to,c.rates);result(w,value);w.expression=calculatorExpressionValue(value);w.repeat=null;record(c,w,`${calculatorFormat(source,{places:32})} ${w.conversion.from} → ${w.conversion.to}${w.conversion.category==='currency'?' (fixed fictional scene rates)':''}`,value,owner.time);}catch(error){w.error={code:error.code??'domain',message:String(error.message).slice(0,256)};w.repeat=null;}return;
    }
    if(suffix==='bit'){if(w.mode!=='programmer'||payload.index>=w.wordBits)throw new CalculatorError('mode','Choose a bit within the Programmer word size.');const v=current(w),n=BigInt.asIntN(w.wordBits,(v.n/v.d)^(1n<<BigInt(payload.index)));result(w,encodeCalculatorValue(rational(n)));w.expression='';w.repeat=null;return;}
   });
  }catch(error){return rejected(error.code??'invalid_arguments',error.message??'Calculator operation failed.');}
 };
 function rowIdForMemory(c){return rowId(c,'memory');}
 function windowOpened(actual,options={}){
  if(!alive()||!validateCalculatorState(state,ctx.profile).ok||!actual||!calculatorSchemaValid(actual.id,calculatorIdSchema)||!owns(actual)||options.sourceGuard&&options.sourceGuard()!==true||options.isCurrent&&options.isCurrent()!==true)return false;
  const existing=calculatorWindow(state,actual.id);if(existing){if(existing.appId!==actual.appId||originalWindows.has(actual.id)&&originalWindows.get(actual.id)!==actual)return false;originalWindows.set(actual.id,actual);return true;}
  if(options.mode!==undefined&&!['basic','scientific','programmer'].includes(options.mode))return false;const candidate=copyCanonicalData(state);candidate.windows.push(createCalculatorWindow(actual.id,actual.appId,options.mode??'basic'));
  const delta=calculatorTextUnits(candidate)-calculatorTextUnits(state);if(!validateCalculatorState(candidate,ctx.profile).ok||ctx.canCommit(delta)!==true||!alive()||options.sourceGuard&&options.sourceGuard()!==true||options.isCurrent&&options.isCurrent()!==true)return false;publish(candidate);originalWindows.set(actual.id,actual);options.onCommit?.({windowId:actual.id,appId:actual.appId});return true;
 }
 function windowClosed(actual){const id=typeof actual==='string'?actual:actual?.id,original=originalWindows.get(id),session=calculatorWindow(state,id);if(!alive()||!session||typeof actual!=='string'&&original&&actual!==original||original&&ctx.getWindow(id)&&ctx.getWindow(id)!==original)return false;const candidate=copyCanonicalData(state);candidate.windows.splice(candidate.windows.findIndex(w=>w.windowId===id),1);if(!validateCalculatorState(candidate,ctx.profile).ok||ctx.canCommit(calculatorTextUnits(candidate)-calculatorTextUnits(state))!==true)return false;publish(candidate);originalWindows.delete(id);return true;}
 function appQuit(appId){if(!alive()||!['calculator','local-calculator','local-radix-lab'].includes(appId)&&!state.windows.some(w=>w.appId===appId&&owns(ctx.getWindow(w.windowId))))return false;const candidate=copyCanonicalData(state),ids=candidate.windows.filter(w=>w.appId===appId).map(w=>w.windowId);candidate.windows.splice(0,candidate.windows.length,...candidate.windows.filter(w=>w.appId!==appId));if(!validateCalculatorState(candidate,ctx.profile).ok||ctx.canCommit(calculatorTextUnits(candidate)-calculatorTextUnits(state))!==true)return false;publish(candidate);for(const id of ids)originalWindows.delete(id);return true;}
 function targets(windowId){const w=calculatorWindow(state,windowId),window=ctx.getWindow(windowId),native=ctx.getView?.(windowId);return {windowId,available:!!lease(windowId),appId:w?.appId??null,capabilities:calculatorCapabilities(ctx.profile,w?.appId),session:w?copyCanonicalData(w):null,display:w?calculatorFormat(w.value,{places:w.places,base:w.base,wordBits:w.wordBits,programmer:w.mode==='programmer'}):null,native:native?.describe?.()??null};}
 return {handlers,targets,windowOpened,windowClosed,appQuit,dispose(){disposed=true;generation++;originalWindows.clear();}};
}
