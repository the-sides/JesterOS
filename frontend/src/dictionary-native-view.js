export function createDictionaryNativeView({root,audio,owns}){
 let disposed=false,playSerial=0;
 const current=()=>!disposed&&owns()===true&&root?.isConnected===true;
 function visible(node){
  if(!current()||!node?.isConnected||!root.contains(node)||node.disabled||node.matches(':disabled')||!node.getClientRects().length)return false;
  const view=node.ownerDocument.defaultView,rect=node.getBoundingClientRect();if(!view||rect.width<=0||rect.height<=0)return false;
  let left=Math.max(0,rect.left),top=Math.max(0,rect.top),right=Math.min(view.innerWidth,rect.right),bottom=Math.min(view.innerHeight,rect.bottom);
  for(let a=node;a;a=a.parentElement){if(a.hidden||a.inert||a.hasAttribute('inert'))return false;const s=view.getComputedStyle(a);if(s.display==='none'||s.visibility==='hidden'||s.visibility==='collapse'||s.opacity==='0')return false;if(a!==node){const clip=a.getBoundingClientRect();if(['auto','scroll','hidden','clip'].includes(s.overflowX)){left=Math.max(left,clip.left+a.clientLeft);right=Math.min(right,clip.left+a.clientLeft+a.clientWidth);}if(['auto','scroll','hidden','clip'].includes(s.overflowY)){top=Math.max(top,clip.top+a.clientTop);bottom=Math.min(bottom,clip.top+a.clientTop+a.clientHeight);}}}
  return right>left&&bottom>top;
 }
 const nodes=()=>current()?[...root.querySelectorAll('[data-dictionary-control]')].filter(visible):[];
 const control=id=>nodes().find(n=>n.dataset.dictionaryControl===id);
 function stopPronunciation(){playSerial++;audio?.pause();if(audio)audio.currentTime=0;}
 return {
  available:()=>visible(root),contains:node=>current()&&root.contains(node),
  describe(){return {controls:nodes().map(n=>n.dataset.dictionaryControl),focusedControl:nodes().find(n=>n===root.ownerDocument.activeElement)?.dataset.dictionaryControl??null,top:control('reader')?.scrollTop??0,pronouncing:!!audio&&!audio.paused};},
  focus(id,guard){const node=control(id);if(!node||guard()!==true)return false;node.focus({preventScroll:true});return current()&&guard()===true&&node.ownerDocument.activeElement===node;},
  scroll({top},guard){const node=control('reader');if(!node||guard()!==true)return false;node.scrollTop=top;return current()&&guard()===true&&Math.abs(node.scrollTop-Math.min(top,Math.max(0,node.scrollHeight-node.clientHeight)))<1;},
  async pronounce(clip,guard){if(!visible(root)||!audio||guard()!==true||!clip?.content?.startsWith('data:audio/ogg;base64,'))return false;stopPronunciation();const serial=playSerial,original=audio;original.src=clip.content;try{await original.play();}catch{return false;}if(!current()||guard()!==true||serial!==playSerial||original!==audio){if(serial===playSerial||!current())original.pause();return false;}return !original.paused&&original.readyState>=2;},
  stopPronunciation,
  destroy(){stopPronunciation();disposed=true;if(audio){audio.removeAttribute('src');audio.load();}}
 };
}
