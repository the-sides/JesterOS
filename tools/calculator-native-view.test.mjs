import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createCalculatorNativeView,calculatorKeyboard,calculatorProgrammerReadout} from '../frontend/src/calculator-native-view.js';
import {createCalculatorState,createCalculatorWindow,calculatorDisplay,CALCULATOR_PROFILES} from '../frontend/src/calculator-state.js';
import {createCalculatorCommands} from '../frontend/src/calculator-commands.js';
function fixture(profileId=CALCULATOR_PROFILES[0]){
 const dom=new JSDOM('<!doctype html><section data-calculator-window-id="calc-1"><button data-calculator-control="key:7">7</button><button data-calculator-control="key:equals">=</button><button data-calculator-control="disabled" disabled>Disabled</button><div inert><button data-calculator-control="inert">Hidden by a modal</button></div><div data-calculator-area="tape"></div></section>'),document=dom.window.document,root=document.querySelector('section'),profile={id:profileId},state=createCalculatorState(profile,{sceneTime:1728057600000});state.windows.push(createCalculatorWindow('calc-1'));const window={id:'calc-1',appId:'calculator'},session=state.windows[0];let enabled=true,flush=()=>Promise.resolve(),currentState=state;
 const facade=createCalculatorNativeView({getRoot:()=>root,getState:()=>currentState,getProfile:()=>profile,windowId:'calc-1',available:()=>enabled,tick:()=>flush()});const controller=createCalculatorCommands(state,{profile,getState:()=>state,getWindow:()=>window,getView:()=>facade,available:()=>enabled,alive:()=>true,getSceneTime:()=>1728057600000,canCommit:()=>true});
 const keyboard=async(key,extra={})=>{const event={key,ctrlKey:false,metaKey:false,altKey:false,shiftKey:false,...extra},request=calculatorKeyboard(event,session,profile);assert.ok(request,`No action for ${key}`);return controller.handlers[`calculator.${request.command}`]({windowId:'calc-1'},request.payload);};
 return {dom,document,root,profile,state,session,facade,controller,keyboard,setEnabled:v=>{enabled=v;},setTick:fn=>{flush=fn;},replaceState:v=>{currentState=v;}};
}
for(const profileId of CALCULATOR_PROFILES)test(`${profileId}: real keyboard entry reaches actual arithmetic, mode and programmer controls`,async()=>{
 const f=fixture(profileId);for(const key of ['2','+','3','*','4','Enter'])assert.equal((await f.keyboard(key)).status,'applied');assert.equal(calculatorDisplay(f.session),profileId.startsWith('windows11')?'20':'14');const modifier=profileId.startsWith('windows11')?{ctrlKey:true}:{metaKey:true};await f.keyboard('2',modifier);for(const key of ['9','^','2','Enter'])await f.keyboard(key);assert.equal(calculatorDisplay(f.session),'81');await f.keyboard('3',modifier);await f.controller.handlers['calculator.settings']({windowId:'calc-1'},{base:16});for(const key of ['f','f','&','f','Enter'])await f.keyboard(key);assert.equal(calculatorDisplay(f.session),'F');const readout=calculatorProgrammerReadout(f.session);assert.equal(readout.bases.find(row=>row.base===10).text,'15');assert.equal(readout.bits.filter(bit=>bit.set).length,4);
});
test('native focus actually focuses only enabled original controls and describes genuine DOM availability',async()=>{
 const f=fixture();assert.equal(await f.facade.focus('key:7',()=>true),true);assert.equal(f.document.activeElement,f.root.querySelector('[data-calculator-control="key:7"]'));assert.equal(await f.facade.focus('disabled',()=>true),false);assert.equal(await f.facade.focus('inert',()=>true),false);assert.equal(f.facade.describe().controls.some(c=>c.id==='disabled'||c.id==='inert'),false);f.setEnabled(false);assert.equal(await f.facade.focus('key:equals',()=>true),false);assert.equal(f.facade.describe().available,false);
});
test('native focus rejects same-ID control replacement during Svelte flush',async()=>{
 const f=fixture();f.setTick(async()=>{const button=f.root.querySelector('[data-calculator-control="key:7"]');button.replaceWith(button.cloneNode(true));});assert.equal(await f.facade.focus('key:7',()=>true),false);
});
test('tape scroll records real offsets but rejects replacement of the original scroller',async()=>{
 const f=fixture(),area=f.root.querySelector('[data-calculator-area="tape"]');assert.equal(await f.facade.scroll({top:120,left:9},()=>true),true);assert.equal(area.scrollTop,120);assert.deepEqual(f.facade.describe().scroll,{top:120,left:9});f.setTick(async()=>area.replaceWith(area.cloneNode()));assert.equal(await f.facade.scroll({top:180,left:0},()=>true),false);
});
test('same-public-ID session/state replacement and disposal retire the original facade',()=>{
 for(const mutation of ['session','state','detach','dispose']){const f=fixture();if(mutation==='session')f.state.windows[0]={...f.session};if(mutation==='state')f.replaceState({...f.state});if(mutation==='detach')f.root.remove();if(mutation==='dispose')f.facade.destroy();assert.equal(f.facade.available(),false,mutation);assert.equal(f.facade.describe().available,false,mutation);}
});
test('native menus dispatch actual conversion and memory behavior with honest disabled state',async()=>{
 const {calculatorMenus}=await import('../frontend/src/calculator-menus.js'),f=fixture();let menus=calculatorMenus({state:f.state,profile:f.profile,windowId:'calc-1'});const request=menus.find(g=>g.id==='convert').children.find(item=>item.id==='convert-length').request;await f.controller.handlers[request.command](request.target,request.payload);await f.controller.handlers['calculator.conversion']({windowId:'calc-1'},{from:'mi',to:'ft',input:'2'});await f.controller.handlers['calculator.convert']({windowId:'calc-1'},{});assert.equal(calculatorDisplay(f.session),'10560');menus=calculatorMenus({state:f.state,profile:f.profile,windowId:'calc-1'});const copy=menus.find(g=>g.id==='edit').children.find(item=>item.id==='copyTape');assert.equal(copy.enabled,true);await f.controller.handlers['calculator.mode']({windowId:'calc-1'},{mode:'programmer'});assert.equal(calculatorMenus({state:f.state,profile:f.profile,windowId:'calc-1'}).find(g=>g.id==='convert').enabled,false);
});
test('collapsed local expression controls and invisible original buttons cannot be focused',async()=>{
 const f=fixture(),details=f.document.createElement('details'),summary=f.document.createElement('summary'),input=f.document.createElement('input');summary.textContent='Local expression editor';input.dataset.calculatorControl='expression';details.append(summary,input);f.root.append(details);assert.equal(await f.facade.focus('expression',()=>true),false);details.open=true;assert.equal(await f.facade.focus('expression',()=>true),true);const button=f.root.querySelector('[data-calculator-control="key:7"]');button.style.display='none';assert.equal(await f.facade.focus('key:7',()=>true),false);
});
test('a replaced windows collection retires native ownership even if it contains the same original row',()=>{
 const f=fixture();f.state.windows=[...f.state.windows];assert.equal(f.facade.available(),false);
});
