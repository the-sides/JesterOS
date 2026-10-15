import { newsReject } from './news-state.js';
export function createNewsNativeView({getRoot,available,tick,windowId}) {
  let retired=false;
  const current=()=>!retired&&getRoot()?.isConnected===true&&available()===true;
  const visible=element=>!!element&&element.getClientRects().length>0&&!element.closest('[inert]')&&!element.disabled;
  function find(attribute,id) {const root=getRoot();return [...(root?.querySelectorAll(`[${attribute}]`)??[])].find(element=>element.getAttribute(attribute)===id&&visible(element))??null;}
  const lease=guard=>{const root=getRoot();return ()=>current()&&getRoot()===root&&guard?.()===true;};
  return {
    available:current,
    describe(){if(!current())return null;const root=getRoot();return {windowId,controlIds:[...root.querySelectorAll('[data-news-control]')].filter(visible).map(element=>element.dataset.newsControl),scrolls:Object.fromEntries([...root.querySelectorAll('[data-news-area]')].filter(visible).map(element=>[element.dataset.newsArea,{top:element.scrollTop,left:element.scrollLeft}]))};},
    async focus({controlId},guard){const valid=lease(guard);if(!valid())return newsReject('stale_target','Native News view unavailable.');const element=find('data-news-control',controlId);if(!element)return newsReject('unavailable','The requested News control is not rendered, visible or enabled.');element.focus();await tick();if(!valid()||find('data-news-control',controlId)!==element||element.ownerDocument.activeElement!==element)return newsReject('stale_target','Actual News focus was not retained.');return {status:'applied',controlId};},
    async selection({controlId,start,end},guard){const valid=lease(guard),element=find('data-news-control',controlId);if(!valid()||!element||typeof element.setSelectionRange!=='function'||start>end||end>element.value.length)return newsReject('unavailable','A real bounded News text selection is unavailable.');element.focus();element.setSelectionRange(start,end);await tick();if(!valid()||find('data-news-control',controlId)!==element||element.selectionStart!==start||element.selectionEnd!==end)return newsReject('stale_target','The original native selection changed.');return {status:'applied',controlId,start:element.selectionStart,end:element.selectionEnd};},
    async scroll({areaId,top,left},guard){const valid=lease(guard),element=find('data-news-area',areaId);if(!valid()||!element)return newsReject('unavailable','The real News scroll region is unavailable.');element.scrollTo({top,left,behavior:'instant'});await tick();if(!valid()||find('data-news-area',areaId)!==element)return newsReject('stale_target','The original scroll region changed.');return {status:'applied',areaId,top:element.scrollTop,left:element.scrollLeft};},
    destroy(){retired=true;},
  };
}
