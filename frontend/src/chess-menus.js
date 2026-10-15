import { chessSession } from './chess-state.js';
export function chessMenuItems(state,windowId){const w=chessSession(state,windowId),item=(id,label,command,payload={},enabled=true)=>({id,label,command,payload,target:{windowId},enabled});return [
 {id:'chess-app',label:'Chess',items:[item('chess-preferences',/sonoma|golden-gate/u.test(state.profileId)?'Settings…':'Preferences…','chess.panel',{panel:'preferences'}),item('chess-help','Chess Help','chess.panel',{panel:'help'})]},
 {id:'chess-game',label:'Game',items:[item('chess-new','New…','chess.panel',{panel:'new'}),item('chess-open','Open…','chess.open'),item('chess-save','Save','chess.save'),item('chess-save-as','Save As…','chess.panel',{panel:'save'}),item('chess-resign','Resign','chess.resign',{},w?.result==='*'),item('chess-draw','Agree to Draw','chess.draw',{},w?.result==='*')]},
 {id:'chess-moves',label:'Moves',items:[item('chess-undo','Take Back Move','chess.undo',{},!!w&&(w.moves.length>0||!!w.pendingPromotion)),item('chess-move-list','Game Log','chess.preferences',{values:{...state.preferences,showMoves:!state.preferences.showMoves}})]},
 {id:'chess-view',label:'View',items:[item('chess-flip','Rotate Board','chess.flip')]}
 ];}
