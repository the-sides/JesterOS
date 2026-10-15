import { chessSession } from '../frontend/src/chess-state.js';
import { replayChess, readPGN } from '../frontend/src/chess-engine.js';
const assert=(value,message)=>{if(!value)throw new Error(message);};
// Run only in the integrated browser against real mounted Root objects/Files.
// This module does not create a fake DOM, fake native facade or replacement state.
export async function runChessNativeBrowserRegression({root,facade,controller,state,windowId,getFile,flush}){
 assert(root?.isConnected&&facade?.available?.()===true,'Original native Chess must be mounted.');
 assert(typeof flush==='function'&&typeof getFile==='function','Actual Root flush and original Files getter are required.');
 const original=chessSession(state,windowId),sessions=state.sessions,moves=original?.moves;
 assert(original&&controller?.handlers,'Original canonical Chess game/controller required.');
 const run=async(name,payload={})=>{const result=await controller.handlers['chess.'+name]({windowId},payload);assert(result?.status==='applied',name+': '+JSON.stringify(result));await flush();return result;};
 const control=id=>root.querySelector(`[data-control="${id}"]`);
 const click=async id=>{const element=control(id);assert(element&&!element.disabled,'Actual enabled native control '+id+' required.');element.click();await flush();};
 const square=(id,text)=>assert(control('square-'+id)?.getAttribute('aria-label')?.includes(text),'Actual board square '+id+' must show '+text);
 await run('new');
 await click('square-e2');assert(original.selected==='e2','Native click must select original e2 pawn.');
 await click('square-e4');assert(original.moves.at(-1)?.san==='e4','Native destination click must make legal e4.');square('e4','White pawn');
 await click('square-d7');await click('square-d5');await click('square-e4');await click('square-d5');
 square('d5','White pawn');assert(replayChess(original.startFen,original.moves).captures[0]==='p','Native capture must retain actual captured pawn.');
 await click('undo');square('d5','Black pawn');square('e4','White pawn');
 assert(chessSession(state,windowId)===original&&state.sessions===sessions&&original.moves===moves,'Native operations must retain original sessions/history identities.');
 await run('new',{fen:'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'});
 await click('square-e1');await click('square-g1');square('g1','White king');square('f1','White rook');
 assert(original.moves.at(-1)?.san==='O-O','Native castling must move king and rook legally.');
 await run('new',{fen:'7k/4P3/8/8/8/8/8/K7 w - - 0 1'});
 await click('square-e7');await click('square-e8');assert(original.panel==='promotion'&&root.querySelector('[role="dialog"]')?.getAttribute('aria-label')==='Promote Pawn','Native pawn destination must open real promotion dialog.');
 await click('promote-n');square('e8','White knight');assert(original.result==='1/2-1/2'&&root.querySelector('[role="dialog"]')?.textContent?.includes('Insufficient mating material'),'Underpromotion must end on actual insufficient material and show dialog.');
 const saved=await run('save',{name:'Browser Local Underpromotion.pgn',saveAs:true}),file=getFile(saved.fileId);
 assert(file&&file.mime==='application/x-chess-pgn','Actual shared Files must retain acknowledged PGN.');
 assert(readPGN(file.content??file.text).moves[0]?.san==='e8=N','Saved real PGN must contain the played underpromotion.');
 await run('new');await run('open',{fileId:file.id});square('e8','White knight');assert(original.moves[0]?.san==='e8=N'&&original.fileId===file.id,'Real original Files open must restore played underpromotion.');
 await run('panel',{panel:'preferences'});const boardSelector=root.querySelector('[role="dialog"] select');assert(boardSelector,'Actual board preferences selector required.');
 boardSelector.value='marble';boardSelector.dispatchEvent(new Event('change',{bubbles:true}));await flush();assert(state.preferences.board==='marble'&&root.querySelector('.chess-board-surround.marble'),'Native board preference must change canonical setting and material surface.');
 assert(chessSession(state,windowId)===original&&state.sessions===sessions&&original.moves===moves,'Save/open/preferences must keep original game and collection identities.');
 return {status:'applied',windowId,fileId:file.id,profileId:state.profileId,behaviors:['native-board-legal-clicks','capture-undo','castling','underpromotion-endgame','genuine-pgn-files-roundtrip','native-material-preferences']};
}
