import { identity, choice, object, empty } from './command-schema.js';
import { applied, invalid, stale, uiState } from './windows11-app-helpers.js';
export const menus = ['navigation'];
export const keys = ['%','CE','C','backspace','reciprocal','square','sqrt','divide','7','8','9','multiply','4','5','6','subtract','1','2','3','add','sign','0','.','equals'];
export const createState = () => ({ ui:uiState(), display:'0', accumulator:null, operator:null, fresh:true, entered:false, repeat:null, expression:'', error:null, memory:[], history:[], nextId:1, panel:'history' });
export const specs = {
 'win11.calculator.key':[empty,object({key:choice(...keys)}),['display','expression'],['calculation','history']],
 'win11.calculator.memory':[empty,object({action:choice('clear','recall','store','add','subtract')}),['display'],['memory']],
 'win11.calculator.panel':[empty,object({panel:choice('history','memory','none')})],
 'win11.calculator.historyRecall':[object({entryId:identity}),empty],
 'win11.calculator.historyClear':[empty,empty],
 'win11.calculator.memoryEntry':[object({entryId:identity}),object({action:choice('recall','delete','add','subtract')})],
};
const format = value => Number(value.toPrecision(15)).toString();
const operate = (a,b,op) => op==='add'?a+b:op==='subtract'?a-b:op==='multiply'?a*b:a/b;
const symbol = op => ({add:'+',subtract:'−',multiply:'×',divide:'÷'}[op]);
export function createCommands(apps) {
 const s=apps.calculator;
 const set = value => { if (!Number.isFinite(value)) { s.display='Cannot divide by zero or invalid input'; s.error='Invalid arithmetic'; s.accumulator=null; s.operator=null; s.repeat=null; } else { s.display=format(value); s.error=null; } s.fresh=true; };
 const record = (a,b,op,value) => { s.expression=`${format(a)} ${symbol(op)} ${format(b)} =`; s.history.unshift({id:`calculation-${s.nextId++}`,expression:s.expression,value:format(value)}); };
 return {
 'win11.calculator.key':(_,{key})=>{
  if(key==='C'){ s.display='0';s.accumulator=null;s.operator=null;s.repeat=null;s.expression='';s.error=null;s.fresh=true;s.entered=false;return applied(); }
  if(key==='CE'){s.display='0';s.error=null;s.fresh=true;s.entered=false;return applied();}
  if(s.error) return invalid('Clear the arithmetic error before continuing.');
  if(/^\d$/.test(key)||key==='.'){if(s.fresh){s.display=key==='.'?'0.':key;s.fresh=false;}else if(key==='.'&&!s.display.includes('.'))s.display+='.';else if(key!=='.'&&s.display.replace('-','').length<16)s.display=s.display==='0'?key:s.display+key;s.entered=true;return applied();}
  const value=Number(s.display);
  if(key==='backspace'){if(!s.fresh){s.display=s.display.slice(0,-1);if(!s.display||s.display==='-')s.display='0';}return applied();}
  if(['sign','%','reciprocal','square','sqrt'].includes(key)){const next=key==='sign'?-value:key==='%'?((s.operator==='add'||s.operator==='subtract')?s.accumulator*value/100:value/100):key==='reciprocal'?1/value:key==='square'?value*value:Math.sqrt(value);set(next);s.entered=true;return applied();}
  if(['add','subtract','multiply','divide'].includes(key)){if(s.operator&&s.entered){const result=operate(s.accumulator,value,s.operator);set(result);if(s.error)return applied();}s.accumulator=Number(s.display);s.operator=key;s.expression=`${s.display} ${symbol(key)}`;s.fresh=true;s.entered=false;s.repeat=null;return applied();}
  if(key==='equals'){const op=s.operator||s.repeat?.op;if(!op){s.fresh=true;return applied();}const a=s.operator?s.accumulator:value;const b=s.operator?value:s.repeat.value;const result=operate(a,b,op);set(result);if(!s.error){record(a,b,op,result);s.repeat={op,value:b};s.accumulator=null;s.operator=null;s.entered=false;}return applied();}
  return invalid();
 },
 'win11.calculator.memory':(_,{action})=>{if(action==='clear'){s.memory=[];return applied();}if(action==='recall'){if(!s.memory.length)return stale('Memory is empty.');set(s.memory[0].value);s.entered=true;return applied();}if(s.error)return invalid('Cannot store an arithmetic error.');const value=Number(s.display);if(action==='store'||!s.memory.length)s.memory.unshift({id:`memory-${s.nextId++}`,value});else {const next=s.memory[0].value+(action==='add'?value:-value);if(!Number.isFinite(next))return invalid('Memory overflow.');s.memory[0].value=next;}s.fresh=true;return applied();},
 'win11.calculator.panel':(_,{panel})=>{s.panel=panel;return applied();},
 'win11.calculator.historyRecall':({entryId})=>{const entry=s.history.find(e=>e.id===entryId);if(!entry)return stale();set(Number(entry.value));s.expression=entry.expression;s.accumulator=null;s.operator=null;s.repeat=null;return applied({entryId});},
 'win11.calculator.historyClear':()=>{s.history=[];return applied();},
 'win11.calculator.memoryEntry':({entryId},{action})=>{const entry=s.memory.find(e=>e.id===entryId);if(!entry)return stale();if(action==='delete')s.memory=s.memory.filter(e=>e!==entry);else if(action==='recall'){set(entry.value);s.entered=true;}else{if(s.error)return invalid();const next=entry.value+(action==='add'?Number(s.display):-Number(s.display));if(!Number.isFinite(next))return invalid('Memory overflow.');entry.value=next;}return applied({entryId});},
 };
}
export const readTargets = apps => ({ keys:[...keys], menus:[...menus], menu:apps.calculator.ui.menu, panel:apps.calculator.panel, display:apps.calculator.display, expression:apps.calculator.expression, history:apps.calculator.history.map(e=>({...e})), memory:apps.calculator.memory.map(e=>({...e})), availability:{memoryRecall:apps.calculator.memory.length>0,memoryClear:apps.calculator.memory.length>0,historyClear:apps.calculator.history.length>0,arithmetic:!apps.calculator.error}, memoryAvailable:apps.calculator.memory.length>0, error:apps.calculator.error });
