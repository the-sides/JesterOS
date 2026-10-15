import {object,choice,flag,empty,defineCommand} from './command-schema.js';
import {SCREEN_SHARING_PROFILES,screenSharingIdSchema} from './screen-sharing-state.js';
const text=(maxLength=256,minLength=0)=>({type:'string',minLength,maxLength}),integer=(minimum,maximum)=>({type:'integer',minimum,maximum});
export const screenSharingTargetSchema=object({windowId:screenSharingIdSchema});
export const screenSharingCommandSpecs={
 select:[object({peerId:choice('studio-mac','library-mac')}),'Select an authored receiver in its distinct local realm.'],
 connect:[object({hostname:text(256,1)},[]),'Open disclosed fictional receiver authentication; arbitrary addresses never contact a network.'],
 authenticate:[object({username:text(64,1),passcode:text(128,1),remember:flag},['username','passcode']),'Authenticate only the selected authored receiver; optional remembered authentication stays in this controller runtime.'],
 disconnect:[empty,'Disconnect this session, leaving the actual peer desktop and files intact.'],
 cancel:[empty,'Cancel pending authentication, file transfer or capture without publishing staged bytes.'],
 policy:[object({administratorId:screenSharingIdSchema,passcode:text(128,1)}),'Verify an actual canonical administrator with Preferences authentication, then enable shared Screen Sharing and grant the actual active local user atomically.'],
 sidebar:[object({id:screenSharingIdSchema}),'Select Network, All Connections or an actual saved group.'],
 'group.add':[object({name:text(64,1)}),'Create a bounded native connection group.'],
 'group.rename':[object({groupId:screenSharingIdSchema,name:text(64,1)}),'Rename an original saved group.'],
 'group.delete':[object({groupId:screenSharingIdSchema}),'Remove the original group and its membership references.'],
 'connection.group':[object({groupId:screenSharingIdSchema,member:flag}),'Add or remove the selected saved connection from an original group.'],
 'connection.delete':[empty,'Forget the selected saved connection; no receiver files or desktop are deleted.'],
 settings:[object({quality:choice('adaptive','full'),scale:choice('fit','actual'),zoom:integer(50,200),mode:choice('control','observe'),connectionType:choice('standard','high-performance'),displays:integer(1,2),display:integer(0,1),dynamicResolution:flag,sharedClipboard:flag,destination:choice('downloads','documents','desktop')},[]),'Apply actual canvas scaling, rendering quality, observation/control and supported virtual display behavior.'],
 'remote.select':[object({fileId:screenSharingIdSchema}),'Select an original File in the connected peer realm.'],
 'remote.open':[object({fileId:screenSharingIdSchema}),'Open the actual peer document in a bounded remote desktop window.'],
 'remote.close':[object({remoteWindowId:screenSharingIdSchema}),'Close the original peer window; its unsaved draft is discarded.'],
 'remote.move':[object({remoteWindowId:screenSharingIdSchema,x:integer(0,700),y:integer(26,420)}),'Move the actual remote desktop window.'],
 'remote.edit':[object({remoteWindowId:screenSharingIdSchema,text:text(65536)}),'Edit the actual text draft rendered on the virtual desktop.'],
 'remote.save':[object({remoteWindowId:screenSharingIdSchema}),'Publish actual draft bytes to the original peer File and update non-dirty views.'],
 'remote.new':[object({name:text(128,1)},[]),'Create an actual text File in this peer realm.'],
 pointer:[object({x:integer(0,1024),y:integer(0,640),action:choice('click','doubleClick','move')}),'Hit-test and interact with the genuinely rendered virtual desktop, never host input.'],
 upload:[object({fileId:screenSharingIdSchema},[]),'Read original canonical local File bytes into the peer realm, or use the actual Files picker.'],
 download:[object({fileId:screenSharingIdSchema},[]),'Atomically transfer actual peer File bytes to a genuine local canonical File with strict planned metadata acknowledgment.'],
 'clipboard.send':[empty,'Paste the single canonical text clipboard into the original peer document draft.'],
 'clipboard.receive':[empty,'Copy selected peer document draft bytes into the single canonical text clipboard atomically.'],
 capture:[empty,'Encode the genuine mounted authored desktop canvas as a real PNG File.'],
 sheet:[object({sheet:{anyOf:[{type:'null'},choice('settings','help','connection')]},menu:{anyOf:[{type:'null'},choice('app','file','edit','view','window','help')]}},[]),'Show native local settings, help or new-connection sheet.'],
 focus:[object({controlId:text(256,1)}),'Focus the original visible enabled mounted control.'],
 scroll:[object({top:integer(0,1000000),left:integer(0,1000000)}),'Scroll the actual native desktop or connections viewport.'],
 'window.new':[object({peerId:choice('studio-mac','library-mac')},[]),'Create a genuinely independent second native session window using the same original creation options.'],
 'window.close':[empty,'Close the original native window under source ownership.'],
};
export const screenSharingCatalog=Object.fromEntries(Object.entries(screenSharingCommandSpecs).map(([suffix,[payload,description]])=>defineCommand(SCREEN_SHARING_PROFILES,`screensharing.${suffix}`,'screensharing.local',screenSharingTargetSchema,payload,['Original actor graph, native window/facade, source realm records, canonical Sharing/user policy and authored scene time.'],[description],['Authored local virtual peers only. No VNC, RDP, host screen, network or WebSocket. Credentials are disclosed fiction and never persisted.'],[],screenSharingTargetSchema)));
