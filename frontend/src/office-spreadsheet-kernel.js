// Shared sparse workbook evaluator. Formula source is parsed, never executed as JavaScript.
export const SPREADSHEET_LIMITS = Object.freeze({rows:1048576,columns:16384,rangeCells:10000,formulaLength:8192,depth:128});
const result=(type,value)=>({type,value}), blank=()=>result('blank',null), error=value=>result('error',value);
export function columnName(column){if(!Number.isInteger(column)||column<1||column>SPREADSHEET_LIMITS.columns)return '';let name='';while(column){column--;name=String.fromCharCode(65+column%26)+name;column=Math.floor(column/26);}return name;}
export function parseCellReference(text){const m=/^(\$?)([A-Za-z]{1,3})(\$?)([1-9][0-9]{0,6})$/.exec(text??'');if(!m)return null;let column=0;for(const c of m[2].toUpperCase())column=column*26+c.charCodeAt(0)-64;const row=Number(m[4]);if(column>SPREADSHEET_LIMITS.columns||row>SPREADSHEET_LIMITS.rows)return null;return {column,row,address:columnName(column)+row,absoluteColumn:!!m[1],absoluteRow:!!m[3]};}
export function parseRange(text){const parts=String(text).split(':');if(parts.length>2)throw Object.assign(new Error('Invalid cell range.'),{code:'invalid_range'});const start=parseCellReference(parts[0]),end=parseCellReference(parts[1]??parts[0]);if(!start||!end)throw Object.assign(new Error('Invalid cell address.'),{code:'invalid_range'});const minRow=Math.min(start.row,end.row),maxRow=Math.max(start.row,end.row),minColumn=Math.min(start.column,end.column),maxColumn=Math.max(start.column,end.column);if((maxRow-minRow+1)*(maxColumn-minColumn+1)>SPREADSHEET_LIMITS.rangeCells)throw Object.assign(new Error('Range exceeds 10,000 cells.'),{code:'limit_exceeded'});const addresses=[];for(let r=minRow;r<=maxRow;r++)for(let c=minColumn;c<=maxColumn;c++)addresses.push(columnName(c)+r);return {start,end,minRow,maxRow,minColumn,maxColumn,addresses};}
function lex(source){if(source.length>SPREADSHEET_LIMITS.formulaLength)throw error('#VALUE!');const tokens=[];let p=0;while(p<source.length){if(/\s/.test(source[p])){p++;continue;}const start=p,c=source[p];if(c==='"'||c==="'"){let text='';p++;let closed=false;while(p<source.length){if(source[p]===c){if(source[p+1]===c){text+=c;p+=2;}else{p++;closed=true;break;}}else text+=source[p++];}if(!closed)throw error('#VALUE!');tokens.push({kind:c==='"'?'string':'sheet',value:text,start,end:p});continue;}const number=/^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(source.slice(p));if(number){p+=number[0].length;tokens.push({kind:'number',value:Number(number[0]),start,end:p});continue;}const ref=/^\$?[A-Za-z]{1,3}\$?[1-9][0-9]*/.exec(source.slice(p));if(ref&&!/[A-Za-z0-9_.]/.test(source[p+ref[0].length]??'')){p+=ref[0].length;tokens.push({kind:'ref',value:ref[0],start,end:p});continue;}const name=/^[A-Za-z_][A-Za-z0-9_.]*/.exec(source.slice(p));if(name){p+=name[0].length;tokens.push({kind:'name',value:name[0],start,end:p});continue;}const err=/^#(?:REF!|DIV\/0!|NAME\?|VALUE!|N\/A|CYCLE!|NUM!)/i.exec(source.slice(p));if(err){p+=err[0].length;tokens.push({kind:'error',value:err[0].toUpperCase(),start,end:p});continue;}const op=/^(?:<>|<=|>=|[+\-*/^&%=<>():!,;])/.exec(source.slice(p));if(!op)throw error('#VALUE!');p+=op[0].length;tokens.push({kind:op[0],value:op[0],start,end:p});}tokens.push({kind:'end',start:p,end:p});return tokens;}
function parse(source){const t=lex(source);let p=0,depth=0;const peek=()=>t[p],take=()=>t[p++],expect=k=>{if(take().kind!==k)throw error('#VALUE!');};const precedence={'=':1,'<>':1,'<':1,'>':1,'<=':1,'>=':1,'&':2,'+':3,'-':3,'*':4,'/':4,'^':6};function expression(min=0){if(++depth>SPREADSHEET_LIMITS.depth)throw error('#VALUE!');let node;const first=take();if(first.kind==='+'||first.kind==='-')node={kind:'unary',op:first.kind,arg:expression(5)};else if(first.kind==='('){node=expression();expect(')');}else if(first.kind==='number'||first.kind==='string'||first.kind==='error')node={kind:first.kind,value:first.value};else if(['name','sheet','ref'].includes(first.kind)){if(peek().kind==='!'){take();const ref=take();if(ref.kind!=='ref')throw error('#REF!');node={kind:'ref',sheet:first.value,ref:ref.value};}else if(first.kind==='ref')node={kind:'ref',sheet:null,ref:first.value};else if(first.kind==='name'&&peek().kind==='('){take();const args=[];if(peek().kind!==')'){do{args.push(expression());if(![',',';'].includes(peek().kind))break;take();}while(true);}expect(')');node={kind:'call',name:first.value.toUpperCase(),args};}else if(first.kind==='name'&&/^(TRUE|FALSE)$/i.test(first.value))node={kind:'boolean',value:first.value.toUpperCase()==='TRUE'};else node={kind:'error',value:'#NAME?'};}else throw error('#VALUE!');if(node.kind==='ref'&&peek().kind===':'){take();const end=take();let sheet=node.sheet,ref=end.value;if(peek().kind==='!'){take();sheet=end.value;ref=take().value;}if(sheet!==node.sheet)throw error('#REF!');node={kind:'range',sheet:node.sheet,start:node.ref,end:ref};}while(peek().kind==='%'){take();node={kind:'unary',op:'%',arg:node};}while(Object.hasOwn(precedence,peek().kind)&&precedence[peek().kind]>=min){const op=take().kind;node={kind:'binary',op,left:node,right:expression(precedence[op]+(op==='^'?0:1))};}depth--;return node;}const ast=expression();if(peek().kind!=='end')throw error('#VALUE!');return ast;}
const scalar=v=>v?.type==='range'?error('#VALUE!'):v;
function numeric(v){v=scalar(v);if(v.type==='error')return v;if(v.type==='number')return v;if(v.type==='blank')return result('number',0);if(v.type==='boolean')return result('number',v.value?1:0);if(v.type==='text'&&v.value.trim()!==''&&Number.isFinite(Number(v.value)))return result('number',Number(v.value));return error('#VALUE!');}
const truth=v=>{v=scalar(v);if(v.type==='error')return v;if(v.type==='boolean')return v;if(v.type==='blank')return result('boolean',false);if(v.type==='number')return result('boolean',v.value!==0);if(/^(true|false)$/i.test(v.value))return result('boolean',v.value.toLowerCase()==='true');return error('#VALUE!');};
export function evaluateWorkbook(document){
 const sheets=Object.create(null),dependencies=Object.create(null),visiting=new Set(),byName=new Map(document.sheets.map(s=>[s.name.toLowerCase(),s]));
 for(const s of document.sheets)sheets[s.id]=Object.create(null);
 let calls=0;
 function evaluate(sheet,address,depth=0){
  if(depth>256||++calls>200000)return error('#VALUE!');
  const ref=parseCellReference(address);if(!ref)return error('#REF!');address=ref.address;
  const key=sheet.id+'!'+address;
  if(Object.hasOwn(sheets[sheet.id],address))return sheets[sheet.id][address];
  if(visiting.has(key))return error('#CYCLE!');
  visiting.add(key);dependencies[key]=[];const deps=new Set();let value;
  try{
   const input=sheet.cells[address]?.input??'';
   if(input.startsWith('=')){
    const ast=parse(input.slice(1));
    const resolve=(name,reference)=>{
     const target=name===null?sheet:byName.get(name.toLowerCase()),ref=parseCellReference(reference);
     if(!target||!ref)return error('#REF!');
     deps.add(target.id+'!'+ref.address);
     return evaluate(target,ref.address,depth+1);
    };
    const run=node=>{
     if(node.kind==='ref')return resolve(node.sheet,node.ref);
     if(node.kind==='range'){
      let range;try{range=parseRange(node.start+':'+node.end);}catch{return error('#REF!');}
      return {type:'range',value:range.addresses.map(a=>resolve(node.sheet,a))};
     }
     if(['number','string','boolean','error'].includes(node.kind))return result(node.kind==='string'?'text':node.kind,node.value);
     if(node.kind==='unary'){
      const n=numeric(run(node.arg));return n.type==='error'?n:finite(node.op==='-'?-n.value:node.op==='%'?n.value/100:n.value);
     }
     if(node.kind==='binary'){
      const a=scalar(run(node.left)),b=scalar(run(node.right));if(a.type==='error')return a;if(b.type==='error')return b;
      if(node.op==='&')return result('text',plain(a)+plain(b));
      if(['=','<>','<','>','<=','>='].includes(node.op)){
       let av=a.type==='blank'?0:a.value,bv=b.type==='blank'?0:b.value;
       if(typeof av==='string')av=av.toLowerCase();if(typeof bv==='string')bv=bv.toLowerCase();
       const rank=v=>typeof v==='number'?0:typeof v==='string'?1:2;
       const compared=typeof av===typeof bv?(av<bv?-1:av>bv?1:0):rank(av)-rank(bv);
       return result('boolean',({'=':compared===0,'<>':compared!==0,'<':compared<0,'>':compared>0,'<=':compared<=0,'>=':compared>=0})[node.op]);
      }
      const an=numeric(a),bn=numeric(b);if(an.type==='error')return an;if(bn.type==='error')return bn;
      if(node.op==='/'&&bn.value===0)return error('#DIV/0!');
      switch(node.op){
       case '+':return finite(an.value+bn.value);case '-':return finite(an.value-bn.value);
       case '*':return finite(an.value*bn.value);case '/':return finite(an.value/bn.value);
       case '^':return finite(an.value**bn.value);default:return error('#VALUE!');
      }
     }
     if(node.kind==='call'){
      if(node.name==='IF'){
       if(node.args.length<2||node.args.length>3)return error('#VALUE!');
       const condition=truth(run(node.args[0]));if(condition.type==='error')return condition;
       return condition.value?run(node.args[1]):node.args[2]?run(node.args[2]):result('boolean',false);
      }
      if(!['SUM','AVERAGE','MIN','MAX','COUNT'].includes(node.name))return error('#NAME?');
      const values=[];
      for(const arg of node.args){
       const v=run(arg);
       if(v.type==='range')values.push(...v.value.filter(x=>x.type==='number'||x.type==='error'));
       else if(arg.kind==='ref'){if(v.type==='number'||v.type==='error')values.push(v);}
       else if(v.type!=='blank')values.push(numeric(v));
      }
      if(node.name==='COUNT')return result('number',values.filter(v=>v.type==='number').length);
      const bad=values.find(v=>v.type==='error');if(bad)return bad;
      const numbers=values.map(v=>v.value);
      if(node.name==='AVERAGE'&&!numbers.length)return error('#DIV/0!');
      return finite(node.name==='SUM'?numbers.reduce((a,b)=>a+b,0):node.name==='AVERAGE'?numbers.reduce((a,b)=>a+b,0)/numbers.length:!numbers.length?0:node.name==='MIN'?Math.min(...numbers):Math.max(...numbers));
     }
     return error('#VALUE!');
    };
    value=scalar(run(ast));
   }else if(!input)value=blank();
   else if(input.startsWith("'"))value=result('text',input.slice(1));
   else if(/^(TRUE|FALSE)$/i.test(input))value=result('boolean',input.toUpperCase()==='TRUE');
   else if(/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(input.trim()))value=finite(Number(input));
   else value=result('text',input);
  }catch(e){value=e?.type==='error'?e:error('#VALUE!');}
  dependencies[key]=[...deps];visiting.delete(key);sheets[sheet.id][address]=value;return value;
 }
 for(const sheet of document.sheets)for(const address of Object.keys(sheet.cells))evaluate(sheet,address);
 return {sheets,dependencies};
}
function finite(value){return Number.isFinite(value)?result('number',value):error('#NUM!');}
function plain(value){return value.type==='blank'?'':value.type==='boolean'?value.value?'TRUE':'FALSE':String(value.value);}
export function cellResult(document,sheetId,address){if(!document.sheets.some(s=>s.id===sheetId)||!parseCellReference(address))return error('#REF!');return evaluateWorkbook(document).sheets[sheetId]?.[parseCellReference(address).address]??blank();}
export function formatCellValue(value,format={}){
 if(value.type!=='number')return plain(value);
 const f=format.numberFormat??'General',n=value.value;
 if(/^(yyyy-mm-dd|m\/d\/yyyy|mm\/dd\/yyyy)$/i.test(f)){
  // Excel's 1900 date system retains the historic nonexistent February 29.
  if(Math.floor(n)===60)return f.toLowerCase()==='yyyy-mm-dd'?'1900-02-29':'2/29/1900';
  const d=new Date(Date.UTC(1899,11,31)+(n-(n>60?1:0))*86400000);
  if(!Number.isFinite(d.getTime()))return '#VALUE!';
  return f.toLowerCase()==='yyyy-mm-dd'?d.toISOString().slice(0,10):`${d.getUTCMonth()+1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
 }
 if(f==='General'||f==='@')return String(Number(n.toPrecision(12)));
 const decimals=Math.min((/\.([0#]+)/.exec(f)?.[1]??'').length,20),percent=f.includes('%'),grouping=f.includes(','),currency=f.includes('$');
 return (currency?'$':'')+new Intl.NumberFormat('en-US',{minimumFractionDigits:decimals,maximumFractionDigits:decimals,useGrouping:grouping}).format(percent?n*100:n)+(percent?'%':'');
}
export function shiftFormulaReferences(input,rowDelta,columnDelta){if(!input.startsWith('='))return input;let tokens;try{tokens=lex(input.slice(1));}catch{return input;}let output='',position=0;const source=input.slice(1);for(let i=0;i<tokens.length;i++){const token=tokens[i];if(token.kind!=='ref'||tokens[i+1]?.kind==='!')continue;const ref=parseCellReference(token.value);if(!ref)continue;const row=ref.row+(ref.absoluteRow?0:rowDelta),column=ref.column+(ref.absoluteColumn?0:columnDelta);output+=source.slice(position,token.start)+(row<1||row>SPREADSHEET_LIMITS.rows||column<1||column>SPREADSHEET_LIMITS.columns?'#REF!':(ref.absoluteColumn?'$':'')+columnName(column)+(ref.absoluteRow?'$':'')+row);position=token.end;}return '='+output+source.slice(position);}
export function chartData(document,sheetId,rangeText,evaluated=null){
 const sheet=document.sheets.find(s=>s.id===sheetId);if(!sheet)throw new Error('Missing chart sheet.');
 const range=parseRange(rangeText),computed=(evaluated??evaluateWorkbook(document)).sheets[sheetId],at=(r,c)=>computed[columnName(c)+r]??blank(),errors=[];
 const header=Array.from({length:range.maxColumn-range.minColumn+1},(_,i)=>at(range.minRow,range.minColumn+i)).some(v=>v.type==='text');
 const firstRow=range.minRow+(header?1:0),labelColumn=range.maxColumn>range.minColumn&&Array.from({length:range.maxRow-firstRow+1},(_,i)=>at(firstRow+i,range.minColumn)).some(v=>v.type==='text');
 const labels=Array.from({length:Math.max(0,range.maxRow-firstRow+1)},(_,i)=>labelColumn?plain(at(firstRow+i,range.minColumn)):String(i+1)),series=[];
 for(let c=range.minColumn+(labelColumn?1:0);c<=range.maxColumn;c++){
  const values=[];
  for(let r=firstRow;r<=range.maxRow;r++){
   const v=at(r,c);if(v.type==='error')errors.push(columnName(c)+r+': '+v.value);
   values.push(v.type==='number'?v.value:0);
  }
  series.push({name:header?plain(at(range.minRow,c)):columnName(c),values});
 }
 return {labels,series,errors};
}
