import {validateStoreState,storeInstalledDescriptors} from './store-state.js';
import {storePackage} from './store-fixtures.js';
import {validateChessState,chessAvailability} from './chess-state.js';
export function gamesSources(store,chess,profile){return !!store&&!!chess&&validateStoreState(store,profile).ok&&validateChessState(chess,profile).ok;}
export function installedGames(store,profile){
 if(!store||!validateStoreState(store,profile).ok)return [];
 // Classify from actual canonical package categories, never Store's editorial Play section.
 return storeInstalledDescriptors(store,profile).filter(row=>storePackage(row.packageId)?.categories.includes('Games'));
}
export function gamesProjection(store,chess,profile,query=''){
 if(!gamesSources(store,chess,profile))return {available:false,installed:[],matches:[],stats:null,chessAppId:null};
 const words=query.trim().toLocaleLowerCase('en-US').split(/\s+/u).filter(Boolean),matchesText=value=>words.every(word=>value.toLocaleLowerCase('en-US').includes(word));
 const played=chess.sessions.filter(row=>row.moves.length>0),stats={scope:'Currently retained local games with played moves',played:played.length,finished:played.filter(row=>row.result!=='*').length,inProgress:played.filter(row=>row.result==='*').length,whiteWins:played.filter(row=>row.result==='1-0').length,blackWins:played.filter(row=>row.result==='0-1').length,draws:played.filter(row=>row.result==='1/2-1/2').length,plies:played.reduce((total,row)=>total+row.moves.length,0)};
 return {available:true,installed:installedGames(store,profile).filter(row=>matchesText(row.name)),matches:chess.sessions.filter(row=>matchesText(`${row.title} Chess ${row.result}`)),stats,chessAppId:chessAvailability(profile).appId,showChess:matchesText('Chess local two-player board game')};
}
