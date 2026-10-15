// Defined local real mathematics, never eval or host code. Angles are radians.
export class GrapherError extends Error { constructor(code,message){super(message);this.code=code;} }
const fail=(message)=>{throw new GrapherError('unsupported_expression',message);};
const functions=Object.freeze({sin:Math.sin,cos:Math.cos,tan:Math.tan,asin:Math.asin,acos:Math.acos,atan:Math.atan,sinh:Math.sinh,cosh:Math.cosh,tanh:Math.tanh,exp:Math.exp,ln:Math.log,log:Math.log10,sqrt:Math.sqrt,abs:Math.abs,floor:Math.floor,ceil:Math.ceil});
export const GRAPHER_TEMPLATES=Object.freeze({cartesian:{dimension:2,expression:'y = sin(x)'},parabola:{dimension:2,expression:'y = x^2'},wave:{dimension:2,expression:'y = sin(x-a)'},surface:{dimension:3,expression:'z = sin(sqrt(x^2+y^2))'},saddle:{dimension:3,expression:'z = x^2-y^2'}});
export function compileGrapherExpression(source,dimension=2){
 if(typeof source!=='string'||source.length>1024||![2,3].includes(dimension))fail('Use a bounded 2D or 3D equation.');
 const assignment=/^\s*([yz])\s*=\s*(.+)$/u.exec(source);if(!assignment||assignment[1]!== (dimension===2?'y':'z'))fail(dimension===2?'Supported form: y = f(x,a).':'Supported form: z = f(x,y,a).');
 const text=assignment[2],tokens=[];let offset=0;
 while(offset<text.length){const match=/^\s*(?:(\d+(?:\.\d*)?|\.\d+)(?:([eE][+-]?\d+))?|([A-Za-z]+)|([+\-*/^(),]))/u.exec(text.slice(offset));if(!match){if(/^\s*$/u.test(text.slice(offset)))break;fail('Unsupported token in equation.');}offset+=match[0].length;tokens.push(match[1]?{kind:'number',value:Number(match[1]+(match[2]??''))}:match[3]?{kind:'name',value:match[3]}:{kind:match[4],value:match[4]});if(tokens.length>256)fail('Equation exceeds 256 tokens.');}
 let i=0,depth=0;const take=kind=>{if(tokens[i]?.kind!==kind)fail(`Expected ${kind}.`);return tokens[i++];};
 function expression(min=0){if(++depth>48)fail('Equation nesting exceeds 48.');let token=tokens[i++],node;if(!token)fail('Missing operand.');
  if(token.kind==='number'){if(!Number.isFinite(token.value))fail('Nonfinite literal.');node={kind:'number',value:token.value};}
  else if(token.kind==='+'||token.kind==='-')node={kind:'unary',operator:token.kind,value:expression(25)};
  else if(token.kind==='('){node=expression();take(')');}
  else if(token.kind==='name'){if(Object.hasOwn(functions,token.value)){take('(');node={kind:'call',name:token.value,value:expression()};take(')');}else if(['x','a','pi','e',...(dimension===3?['y']:[])].includes(token.value))node={kind:'variable',name:token.value};else fail(`Unsupported name ${token.value}.`);}
  else fail('Expected a real operand.');
  while(i<tokens.length){const operator=tokens[i].kind,precedence={'+':10,'-':10,'*':20,'/':20,'^':30}[operator];if(precedence===undefined||precedence<min)break;i++;node={kind:'binary',operator,left:node,right:expression(operator==='^'?precedence:precedence+1)};}depth--;return node;
 }
 const ast=expression();if(i!==tokens.length)fail('Unexpected token; implicit multiplication, series, derivatives and implicit equations are unsupported.');
 function evaluate(node,variables){if(node.kind==='number')return node.value;if(node.kind==='variable')return node.name==='pi'?Math.PI:node.name==='e'?Math.E:variables[node.name]??0;if(node.kind==='unary')return (node.operator==='-'?-1:1)*evaluate(node.value,variables);if(node.kind==='call')return functions[node.name](evaluate(node.value,variables));const l=evaluate(node.left,variables),r=evaluate(node.right,variables);return node.operator==='+'?l+r:node.operator==='-'?l-r:node.operator==='*'?l*r:node.operator==='/'?l/r:l**r;}
 return {ast,evaluate(variables={}){return evaluate(ast,variables);}};
}
export function grapherParameter(document,time){const animation=document.animation;if(!animation.playing)return animation.value;const phase=((time-animation.started)/1000*animation.speed)% (animation.max-animation.min);return animation.min+(phase+animation.max-animation.min)%(animation.max-animation.min);}
export function sampleGrapher(document,{width=800,height=600,time=0}={}){
 const r=document.range,a=grapherParameter(document,time),paths=[];
 const project=(x,y,z=0)=>{if(document.dimension===2)return [(x-r.xMin)/(r.xMax-r.xMin)*width,height-(y-r.yMin)/(r.yMax-r.yMin)*height];const nx=(x-r.xMin)/(r.xMax-r.xMin)-.5,ny=(y-r.yMin)/(r.yMax-r.yMin)-.5,nz=(z-r.zMin)/(r.zMax-r.zMin)-.5,angle=document.rotation*Math.PI/180,u=nx*Math.cos(angle)-ny*Math.sin(angle),v=nx*Math.sin(angle)+ny*Math.cos(angle);return [width*(.5+.7*u),height*(.5+.3*v-.6*nz)];};
 for(const equation of document.equations){if(!equation.visible)continue;const compiled=compileGrapherExpression(equation.expression,document.dimension);let current=[];
  const flush=()=>{if(current.length>1)paths.push({equationId:equation.id,color:equation.color,width:equation.width,points:current});current=[];};
  const append=(x,y,z)=>{const value=document.dimension===2?y:z;if(!Number.isFinite(value)||value<(document.dimension===2?r.yMin:r.zMin)||value>(document.dimension===2?r.yMax:r.zMax)){flush();return;}const p=project(x,y,z);if(current.length&&Math.abs(p[1]-current[current.length-1][1])>height*.45)flush();current.push(p);};
  if(document.dimension===2){for(let n=0;n<=800;n++){const x=r.xMin+(r.xMax-r.xMin)*n/800;append(x,compiled.evaluate({x,a}),0);}flush();}
  else {for(let direction=0;direction<2;direction++)for(let row=0;row<=24;row++){for(let col=0;col<=48;col++){const x=r.xMin+(r.xMax-r.xMin)*(direction?row/24:col/48),y=r.yMin+(r.yMax-r.yMin)*(direction?col/48:row/24);append(x,y,compiled.evaluate({x,y,a}));}flush();}}
 }
 const axes=document.axes?[{color:'#777777',width:1,points:[project(r.xMin,0,0),project(r.xMax,0,0)]},{color:'#777777',width:1,points:[project(0,r.yMin,0),project(0,r.yMax,0)]},...(document.dimension===3?[{color:'#777777',width:1,points:[project(0,0,r.zMin),project(0,0,r.zMax)]}]:[])]:[];
 const grid=[];if(document.grid&&document.dimension===2){for(let n=1;n<10;n++){const x=width*n/10,y=height*n/10;grid.push({color:'#e2e5e8',width:.5,points:[[x,0],[x,height]]},{color:'#e2e5e8',width:.5,points:[[0,y],[width,y]]});}}
 return {width,height,paths:[...grid,...axes,...paths],parameter:a};
}
export function grapherSVG(document,options={}){const plot=sampleGrapher(document,options);return `<svg xmlns="http://www.w3.org/2000/svg" width="${plot.width}" height="${plot.height}" viewBox="0 0 ${plot.width} ${plot.height}"><rect width="100%" height="100%" fill="white"/>${plot.paths.map(p=>`<polyline fill="none" stroke="${p.color}" stroke-width="${p.width}" points="${p.points.map(point=>point.map(v=>v.toFixed(3)).join(',')).join(' ')}"/>`).join('')}</svg>`;}
export async function grapherPDF(document,{guard=()=>true,time=0}={}){if(guard()!==true)throw new GrapherError('stale_target','Original graph changed.');const {PDFDocument,rgb}=await import('pdf-lib');if(guard()!==true)throw new GrapherError('stale_target','Original graph changed.');const pdf=await PDFDocument.create(),page=pdf.addPage([800,600]),plot=sampleGrapher(document,{time});pdf.setCreationDate(new Date(time));pdf.setModificationDate(new Date(time));pdf.setProducer('JesterOS local Grapher');pdf.setTitle(document.title);for(const path of plot.paths){const channels=path.color.slice(1).match(/../gu).map(n=>parseInt(n,16)/255);for(let i=1;i<path.points.length;i++)page.drawLine({start:{x:path.points[i-1][0],y:600-path.points[i-1][1]},end:{x:path.points[i][0],y:600-path.points[i][1]},thickness:path.width,color:rgb(...channels)});}const bytes=await pdf.save();if(guard()!==true)throw new GrapherError('stale_target','Original graph changed.');return bytes;}
