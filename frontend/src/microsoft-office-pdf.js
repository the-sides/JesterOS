import {copyCanonicalData} from './canonical-data.js';
import {decodePreviewData} from './preview-codec.js';
import {evaluateWorkbook,formatCellValue,chartData} from './office-spreadsheet-kernel.js';
const fail=(code,message)=>{const error=new Error(message);error.code=code;throw error;};
const owned=guard=>{if(guard()!==true)fail('stale_target','Original Office document changed during PDF rendering.');};
async function defaultFont(){const response=await fetch('/fonts/LiberationSans-Regular.ttf');if(!response.ok)fail('unavailable','Bundled licensed PDF font is unavailable.');return new Uint8Array(await response.arrayBuffer());}
/** Real vector/image PDF of the supported Office document subset. Font substitution is explicit. */
export async function createMicrosoftOfficePDF(appId,document,sceneTime=0,{guard=()=>true,fontLoader=defaultFont}={}){
 owned(guard);const doc=copyCanonicalData(document),lib=await import('pdf-lib');owned(guard);const module=await import('@pdf-lib/fontkit');owned(guard);const bytes=await fontLoader();owned(guard);if(!(bytes instanceof Uint8Array)||!bytes.length)fail('unavailable','A genuine bundled font is required.');const fontkit=module.default??module,face=fontkit.create(bytes),pdf=await lib.PDFDocument.create();owned(guard);pdf.registerFontkit(fontkit);const font=await pdf.embedFont(bytes,{subset:true});owned(guard);
 const timestamp=Number.isSafeInteger(sceneTime)&&sceneTime>=0?sceneTime:0;pdf.setCreationDate(new Date(timestamp));pdf.setModificationDate(new Date(timestamp));pdf.setTitle(doc.title||'Untitled');pdf.setProducer('JesterOS local Microsoft Office equivalent');pdf.setSubject('Supported vector document rendering. Named fonts use bundled Liberation Sans substitution.');
 const color=hex=>{if(!/^#[0-9a-f]{6}$/i.test(hex??''))hex='#000000';return lib.rgb(parseInt(hex.slice(1,3),16)/255,parseInt(hex.slice(3,5),16)/255,parseInt(hex.slice(5,7),16)/255);};
 const safeText=text=>{text=String(text);for(const char of text){if(/[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff]/u.test(char))fail('unsupported_content','Bidirectional PDF shaping is not supported.');if(char!=='\n'&&char!=='\t'&&!face.hasGlyphForCodePoint(char.codePointAt(0)))fail('unsupported_content','Bundled font cannot render an authored character.');}return text;};
 const wrap=(text,size,width)=>{const lines=[];for(const paragraph of safeText(text).split('\n')){let line='';for(const token of paragraph.match(/\S+\s*|\s+/gu)??['']){if(font.widthOfTextAtSize(token.trimEnd(),size)>width){for(const char of token){if(line&&font.widthOfTextAtSize(line+char,size)>width){lines.push(line);line='';}line+=char;}continue;}if(line&&font.widthOfTextAtSize(line+token,size)>width){lines.push(line.trimEnd());line='';}line+=token;}lines.push(line.trimEnd());}return lines;};
 function text(page,value,x,y,width,style={}){const size=style.fontSize??11,lineHeight=size*1.3,lines=wrap(value,size,Math.max(1,width));for(const line of lines){const measured=font.widthOfTextAtSize(line,size),left=x+(style.align==='center'?(width-measured)/2:style.align==='right'?width-measured:0),options={x:left,y,font,size,color:color(style.color??'#000000'),...(style.italic?{xSkew:lib.degrees(12)}:{})};page.drawText(line,options);if(style.bold)page.drawText(line,{...options,x:left+size*.018});if(style.underline)page.drawLine({start:{x:left,y:y-size*.12},end:{x:left+measured,y:y-size*.12},thickness:.6,color:options.color});y-=lineHeight;}return y;}
 function richLines(paragraph,width){
  const lines=[];let fragments=[],used=0,height=0;
  const finish=()=>{lines.push({fragments,width:used,height:Math.max(height,paragraph.style.fontSize)*1.3});fragments=[];used=0;height=0;};
  const runs=paragraph.runs??[{text:paragraph.text,...paragraph.style,size:paragraph.style.fontSize}];
  for(const run of runs){
   const style={...paragraph.style,...run,fontSize:run.size??run.fontSize??paragraph.style.fontSize};
   for(const character of safeText(run.text)){
    if(character==='\n'){finish();continue;}
    const value=character==='\t'?'    ':character,advance=font.widthOfTextAtSize(value,style.fontSize);
    if(used&&used+advance>width)finish();
    const last=fragments.at(-1);if(last?.run===run){last.text+=value;last.width+=advance;}else fragments.push({text:value,style,width:advance,run});
    used+=advance;height=Math.max(height,style.fontSize);
   }
  }
  finish();return lines;
 }
 async function image(page,row,x,y,width,height){const decoded=decodePreviewData(row.content);if(!['image/png','image/jpeg'].includes(decoded.mime))fail('unsupported_content','Office PDF images require genuine PNG or JPEG.');const embedded=await (decoded.mime==='image/png'?pdf.embedPng(decoded.bytes):pdf.embedJpg(decoded.bytes));owned(guard);page.drawImage(embedded,{x,y,width,height});}
 const page=(width=595.28,height=841.89)=>{if(pdf.getPageCount()>=128)fail('limit_exceeded','Office PDF is limited to 128 pages.');return pdf.addPage([width,height]);};
 function chart(p,data,{x,y,width,height,type='bar',title=''}){
  const {labels,series}=data;if(!series.length||!labels.length)return;
  const colors=['#4472c4','#ed7d31','#a5a5a5','#ffc000','#5b9bd5','#70ad47'],numbers=series.flatMap(row=>row.values),min=Math.min(0,...numbers),max=Math.max(1,...numbers),scaled=value=>y+(value-min)/(max-min)*height,baseline=scaled(0);
  text(p,title,x,y+height+20,width,{fontSize:10});
  for(let n=0;n<series.length;n++)text(p,series[n].name,x+n*width/series.length,y+height+7,width/series.length,{fontSize:7,color:colors[n%colors.length]});
  if(type==='pie'){
   const values=series[0].values,total=values.reduce((n,value)=>n+Math.max(0,value),0);if(!total)return;let angle=0;
   const radius=Math.min(width,height)/2,cx=x+width/2,cy=y+height/2;
   for(let n=0;n<values.length;n++){
    const sweep=Math.max(0,values[n])/total*Math.PI*2,steps=Math.max(2,Math.ceil(sweep/.1)),points=['M 0 0'];
    for(let j=0;j<=steps;j++)points.push(`L ${Math.cos(angle+sweep*j/steps)*radius} ${-Math.sin(angle+sweep*j/steps)*radius}`);
    p.drawSvgPath(points.join(' ')+' Z',{x:cx,y:cy,color:color(colors[n%colors.length])});angle+=sweep;
   }
   return;
  }
  p.drawLine({start:{x,y:baseline},end:{x:x+width,y:baseline},color:color('#777777'),thickness:.5});
  for(let s=0;s<series.length;s++){
   let previous=null;
   for(let n=0;n<labels.length;n++){
    const groupWidth=width/labels.length,left=x+n*groupWidth,value=series[s].values[n],point={x:left+groupWidth/2,y:scaled(value)};
    if(type==='line'){if(previous)p.drawLine({start:previous,end:point,color:color(colors[s%colors.length]),thickness:1.5});previous=point;}
    else{const barWidth=groupWidth/series.length;p.drawRectangle({x:left+s*barWidth+1,y:Math.min(baseline,point.y),width:Math.max(.5,barWidth-2),height:Math.abs(point.y-baseline),color:color(colors[s%colors.length])});}
    if(s===0)text(p,labels[n],left,y-13,groupWidth,{fontSize:7});
   }
  }
 }
 if(appId==='word'){
  const width=doc.page.width,height=doc.page.height,margin=doc.page.margin;let p=page(width,height),y=height-margin;const ensure=h=>{if(h>height-2*margin)fail('unsupported_content','A Word element is larger than its page.');if(y-h<margin){p=page(width,height);y=height-margin;}};
  for(const paragraph of doc.paragraphs){
   const lines=richLines(paragraph,width-2*margin);
   for(const [lineIndex,line] of lines.entries()){
    ensure(line.height+6);
    let x=margin+(paragraph.style.align==='center'?(width-2*margin-line.width)/2:paragraph.style.align==='right'?width-2*margin-line.width:0);
    const spaces=line.fragments.reduce((count,fragment)=>count+(fragment.text.match(/ /g)?.length??0),0),extra=paragraph.style.align==='justify'&&lineIndex<lines.length-1&&spaces?(width-2*margin-line.width)/spaces:0;
    for(const fragment of line.fragments){
     if(extra>0){
      for(const token of fragment.text.split(/( )/)){
       const advance=font.widthOfTextAtSize(token,fragment.style.fontSize);
       text(p,token,x,y,advance+.01,{...fragment.style,align:'left'});x+=advance+(token===' '?extra:0);
      }
     }else{text(p,fragment.text,x,y,fragment.width+.01,{...fragment.style,align:'left'});x+=fragment.width;}
    }
    y-=line.height;
   }
   y-=6;
  }
  for(const table of doc.tables){const count=Math.max(...table.rows.map(row=>row.length)),cellWidth=(width-2*margin)/count;for(const row of table.rows){const h=Math.max(26,...row.map(cell=>wrap(cell,10,cellWidth-8).length*13+8));ensure(h);for(let c=0;c<row.length;c++){p.drawRectangle({x:margin+c*cellWidth,y:y-h,width:cellWidth,height:h,borderWidth:.5,borderColor:color('#777777')});text(p,row[c],margin+c*cellWidth+4,y-12,cellWidth-8,{fontSize:10});}y-=h;}y-=10;}
  for(const item of doc.images){const scale=Math.min(1,(width-2*margin)/item.width),w=item.width*scale,h=item.height*scale;ensure(h+8);await image(p,item,margin,y-h,w,h);y-=h+8;}
 }else if(appId==='excel'){
  const calculated=evaluateWorkbook(doc);
  for(const sheet of doc.sheets){
   const addresses=Object.keys(sheet.cells),coordinates=addresses.map(a=>/^([A-Z]+)([1-9]\d*)$/.exec(a));
   if(coordinates.some(v=>!v))fail('unsupported_content','Invalid spreadsheet reference.');
   const index=letters=>{let n=0;for(const char of letters)n=n*26+char.charCodeAt(0)-64;return n-1;},maxRow=Math.max(0,...coordinates.map(v=>Number(v[2]))),maxCol=Math.max(0,...coordinates.map(v=>index(v[1])));
   if(maxRow>200||maxCol>25)fail('unsupported_content','PDF spreadsheet printing supports used ranges up to 200 rows by 26 columns.');
   const names=n=>{let s='';for(n++;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;};
   const width=841.89,height=595.28,margin=28,authoredWidths=Array.from({length:maxCol+1},(_,c)=>(sheet.columnWidths[names(c)]??96)*.75),scale=Math.min(1,(width-2*margin)/authoredWidths.reduce((sum,value)=>sum+value,0)),widths=authoredWidths.map(value=>value*scale),lefts=[];let offset=margin;
   for(const cellWidth of widths){lefts.push(offset);offset+=cellWidth;}
   let p=page(width,height),y=height-margin;text(p,sheet.name,margin,y,width-margin*2,{fontSize:14,bold:true});y-=25;
   for(let r=1;r<=maxRow;r++){
    const layout=Array.from({length:maxCol+1},(_,c)=>{
     const address=names(c)+r,cell=sheet.cells[address],result=calculated.sheets[sheet.id]?.[address],style=cell?.format??{},fontSize=(style.fontSize??11)*scale,value=result?formatCellValue(result,style):'';
     return {value,style:{...style,fontSize},height:wrap(value,fontSize,widths[c]-8).length*fontSize*1.3+8};
    });
    const rowHeight=Math.max((sheet.rowHeights[String(r)]??24)*.75*scale,...layout.map(cell=>cell.height));
    if(rowHeight>height-2*margin)fail('unsupported_content','An authored spreadsheet row cannot fit on one PDF page.');
    if(y-rowHeight<margin){p=page(width,height);y=height-margin;}
    for(let c=0;c<=maxCol;c++){
     const cell=layout[c];p.drawRectangle({x:lefts[c],y:y-rowHeight,width:widths[c],height:rowHeight,color:color(cell.style.fill??'#ffffff'),borderWidth:.35,borderColor:color('#cccccc')});
     text(p,cell.value,lefts[c]+4,y-cell.style.fontSize-3,widths[c]-8,cell.style);
    }
    y-=rowHeight;
   }
   for(const item of sheet.charts){
    const data=chartData(doc,sheet.id,item.range,calculated);
    if(data.errors.length)fail('unsupported_content','Resolve chart source formula errors before PDF export: '+data.errors.join(', '));
    if(y-185<margin){p=page(width,height);y=height-margin;}
    chart(p,data,{x:margin,y:y-150,width:Math.min(500,width-margin*2),height:120,type:item.type,title:item.title});y-=190;
   }
  }
 }else if(appId==='powerpoint'){
  for(const slide of doc.slides){
   const p=page(doc.width,doc.height);p.drawRectangle({x:0,y:0,width:doc.width,height:doc.height,color:color(slide.background)});
   for(const object of slide.objects){
    const x=object.x,y=doc.height-object.y-object.height,w=object.width,h=object.height;
    if(object.type==='image'){await image(p,object,x,y,w,h);continue;}
    if(object.type==='shape'){
     if(object.shape==='ellipse')p.drawEllipse({x:x+w/2,y:y+h/2,xScale:w/2,yScale:h/2,color:color(object.fill)});
     else if(object.shape==='line')p.drawLine({start:{x,y:y+h},end:{x:x+w,y},color:color(object.fill),thickness:3});
     else p.drawRectangle({x,y,width:w,height:h,color:color(object.fill)});
    }
    if(object.text){
     const lines=wrap(object.text,object.fontSize,w-8);
     if(lines.length*object.fontSize*1.3>h)fail('unsupported_content','Slide text overflows its authored box; enlarge the box before PDF export.');
     text(p,object.text,x+4,y+h-object.fontSize-4,w-8,object);
    }
   }
  }
 }else fail('invalid_arguments','Unknown Office application.');
 if(pdf.getPageCount()===0)page();owned(guard);const output=await pdf.save();owned(guard);return output;
}
