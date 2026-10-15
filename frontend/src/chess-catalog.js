import { object, choice, empty, defineCommand } from './command-schema.js';
import { CHESS_PROFILES, chessIdSchema, chessSquareSchema, chessPreferencesSchema } from './chess-state.js';
const text=(maxLength,minLength=0)=>({type:'string',maxLength,minLength});
export const chessWindowTarget=object({windowId:chessIdSchema});
export const chessCommandPayloads={
 'chess.select':object({square:chessSquareSchema}),
 'chess.move':object({from:chessSquareSchema,to:chessSquareSchema,promote:choice('q','r','b','n')},['from','to']),
 'chess.promote':object({piece:choice('q','r','b','n')}),'chess.undo':empty,
 'chess.new':object({orientation:choice('white','black'),fen:text(256,1)},[]),
 'chess.open':object({fileId:chessIdSchema,format:choice('pgn','fen')},[]),
 'chess.save':object({name:text(256,1),format:choice('pgn','fen'),saveAs:{type:'boolean'}},[]),
 'chess.flip':empty,'chess.resign':empty,'chess.draw':empty,
 'chess.preferences':object({values:chessPreferencesSchema}),
 'chess.panel':object({panel:choice('none','new','preferences','save','help')}),
 'chess.closeDecision':object({decision:choice('save','discard','cancel')}),
 'chess.focus':object({controlId:text(128,1)}),
 'chess.scroll':object({top:{type:'number',minimum:0,maximum:1000000}})
};
export const chessCatalog=Object.fromEntries(Object.entries(chessCommandPayloads).map(([name,payload])=>defineCommand(CHESS_PROFILES,name,'chess.local',chessWindowTarget,payload,['Original canonical per-window Chess game and Root window identities.','Orthodox legal local two-player moves; real bounded PGN and FEN Files, no remote opponent.'],[`${name.slice(6)} on a playable guarded Chess game.`],['chess'],[],chessWindowTarget)));
