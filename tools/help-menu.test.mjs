import { expect, test } from 'bun:test';
import { helpMenuResults, helpMenuProviders, helpMenuLocation } from '../frontend/src/help-menu-model.js';
import { getOSProfile } from '../frontend/src/os-profiles.js';
const profile = getOSProfile('macos-golden-gate-27.0.1');
const leaf = (id,label,enabled=true) => ({id,label,enabled,request:enabled?{command:'window.close',target:{windowId:id},payload:{}}:undefined});
const provider = (menuId,appId,items) => ({menuId,kind:menuId,label:menuId,appId,enabled:true,items});

test('Help search preserves exact nested identity and unavailable ancestry, not other apps or Help recursion',()=>{
 const menus=[provider('file','notes',[{id:'export',label:'Export To',enabled:true,children:[leaf('pdf','PDF…'),leaf('markdown','Markdown…')]}]),
 provider('view','notes',[{id:'zoom',label:'Zoom',enabled:false,children:[leaf('pdf','PDF Preview')]}]),
 provider('file','safari',[leaf('foreign','PDF Safari')]),provider('help','notes',[leaf('recursive','PDF Help')])];
 const matches=helpMenuResults(menus,'notes','pdf');
 expect(matches.map(r=>[r.menuId,r.pathIds,r.enabled])).toEqual([['file',['export','pdf'],true],['view',['zoom','pdf'],false]]);
 expect(matches[0].resultId).not.toBe(matches[1].resultId);
 expect(helpMenuResults(menus,'notes','FILE export PDF').map(r=>r.pathLabels)).toEqual([['file','Export To','PDF…']]);
 expect(helpMenuResults(menus,'notes','.*')).toEqual([]);
 expect(helpMenuResults(menus,'notes','   ')).toEqual([]);
});

test('Help location follows current live target removal and does not cache a replacement menu tree',()=>{
 const menus=[provider('window','notes',[leaf('note-original','Cue document')]),provider('help','notes',[leaf('app-help','Notes Help')])];
 const result=helpMenuResults(menus,'notes','Cue')[0];
 const state={menuId:'help',appId:'notes',helpSearch:{query:'Cue',locationId:result.resultId}};
 expect(helpMenuLocation(menus,state).levels[0].items).toBe(menus[0].items);
 menus[0].items=[leaf('note-replacement','Cue document')];
 expect(helpMenuLocation(menus,state)).toBeNull();
 state.appId='safari';expect(helpMenuLocation(menus,state)).toBeNull();
});

test('Help topic results are owner scoped and unavailable command rows remain location-only',()=>{
 const menus=[provider('format','notes',[leaf('bold','Bold',false)]),provider('help','notes',[leaf('app-help','Notes Help')])];
 const state={menuId:'help',appId:'notes',helpSearch:{query:'bold',locationId:null}};
 const help=helpMenuProviders(menus,state,profile).find(m=>m.menuId==='help');
 const row=help.items.find(i=>i.helpResult);
 expect(row.enabled).toBe(true);expect(row.helpResult.enabled).toBe(false);expect(row.request).toBeUndefined();
 expect(help.items.some(i=>i.id==='app-help')).toBe(true);
 state.appId='safari';expect(helpMenuProviders(menus,state,profile).find(m=>m.menuId==='help').search.query).toBe('');
});
