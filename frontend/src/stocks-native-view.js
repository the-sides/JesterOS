export function createStocksNativeView({getRoot,getState,windowId,available,tick,getMenus}) {
 const root=getRoot(),state=getState(),session=state.windows.find(w=>w.windowId===windowId);let retired=false;
 const owned=()=>!retired&&root?.isConnected===true&&getRoot()===root&&getState()===state&&state.windows.find(w=>w.windowId===windowId)===session&&root.dataset.stocksWindowId===windowId&&available()===true;
 function visible(node){if(!owned()||!node?.isConnected||!root.contains(node)||node.disabled)return false;const modal=root.querySelector('[aria-modal="true"]');if(modal&&!modal.contains(node))return false;for(let p=node;p;p=p.parentElement){const style=p.ownerDocument.defaultView.getComputedStyle(p);if(p.hidden||p.inert||style.display==='none'||style.visibility==='hidden'||style.opacity==='0')return false;}return [...node.getClientRects()].some(r=>r.width>0&&r.height>0);}
 const control=id=>[...root.querySelectorAll('[data-stocks-control]')].find(n=>n.dataset.stocksControl===id&&visible(n));
 const area=id=>[...root.querySelectorAll('[data-stocks-area]')].find(n=>n.dataset.stocksArea===id&&visible(n));
 const valid=guard=>owned()&&(!guard||guard()===true)&&owned();
 async function focus(id,guard){const node=control(id);if(!node||!valid(guard))return false;await tick();if(!valid(guard)||control(id)!==node)return false;node.focus({preventScroll:true});return valid(guard)&&node.ownerDocument.activeElement===node;}
 async function scroll(id,offsets,guard){const node=area(id);if(!node||!valid(guard))return null;await tick();if(!valid(guard)||area(id)!==node)return null;node.scrollTop=offsets.top;node.scrollLeft=offsets.left;return valid(guard)&&area(id)===node?{top:node.scrollTop,left:node.scrollLeft}:null;}
 function describe(){return {controlIds:owned()?[...root.querySelectorAll('[data-stocks-control]')].filter(visible).map(n=>n.dataset.stocksControl):[],quoteIds:owned()?[...root.querySelectorAll('[data-stocks-symbol]')].filter(visible).map(n=>n.dataset.stocksSymbol):[],storyIds:owned()?[...root.querySelectorAll('[data-stocks-story]')].filter(visible).map(n=>n.dataset.stocksStory):[],menus:owned()?[...root.querySelectorAll('[role="menu"]')].filter(visible).map(n=>n.getAttribute('aria-label')):[]};}
 return {available:owned,focus,scroll,describe,getMenus:()=>owned()?getMenus():[],destroy:()=>{retired=true;}};
}
