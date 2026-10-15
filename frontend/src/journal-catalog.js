import {object,choice,empty,flag,defineCommand} from './command-schema.js';
import {JOURNAL_PROFILES,journalId,journalText,journalNumber,journalBlockSchema} from './journal-state.js';
export const journalWindowTarget=object({windowId:journalId});
const optional=properties=>object(properties,[]),patch=object(Object.fromEntries(Object.entries(journalBlockSchema.properties).filter(([k])=>k!=='id')),[]);
export const journalCommandPayloads={
 'journal.new':optional({title:journalText(256,1)}),'journal.open':optional({fileId:journalId}),
 'journal.window.new':empty,
 'journal.document.select':object({documentId:journalId}),'journal.document.rename':object({title:journalText(256,1)}),
 'journal.entry.add':optional({title:journalText(256,1)}),'journal.entry.select':object({entryId:journalId}),'journal.entry.update':optional({title:journalText(256,1),date:journalText(10,10),bookmark:flag}),'journal.entry.delete':empty,
 'journal.block.add':optional({kind:choice('paragraph','heading','quote','bullet')}),'journal.block.select':object({blockId:journalId}),'journal.block.update':object({values:patch}),'journal.block.delete':empty,
 'journal.attachment.add':optional({fileId:journalId,photoId:journalId}),'journal.attachment.remove':object({attachmentId:journalId}),'journal.attachment.export':object({attachmentId:journalId}),
 'journal.attachment.play':object({attachmentId:journalId,playing:flag}),
 'journal.save':optional({name:journalText(256,1),saveAs:flag}),'journal.export':object({format:choice('jjournal','html','pdf'),name:journalText(256,1)},['format']),'journal.print':empty,'journal.share':empty,
 'journal.undo':empty,'journal.redo':empty,'journal.copy':empty,'journal.paste':empty,
 'journal.preferences':optional({photoSuggestions:flag,fileSuggestions:flag,lockOnClose:flag}),
 'journal.lock.configure':object({passphrase:journalText(256,8)}),'journal.lock':empty,'journal.unlock':object({passphrase:journalText(256,1)}),
 'journal.view':optional({search:journalText(),filter:choice('all','bookmarked','attachments'),month:journalText(7)}),
 'journal.panel':object({panel:choice('none','save','export','preferences','help','close','lock','attachments')}),
 'journal.menu':object({menuId:{anyOf:[{type:'null'},choice('app','file','edit','format','view','window','help')]}}),
 'journal.close':optional({decision:choice('save','discard','cancel')}),
 'journal.focus':object({controlId:journalText(128,1)}),'journal.scroll':object({areaId:choice('entries','editor','suggestions'),top:journalNumber(0,1000000),left:journalNumber(0,1000000)})
};
export const journalCatalog=Object.fromEntries(Object.entries(journalCommandPayloads).map(([name,payload])=>defineCommand(JOURNAL_PROFILES,name,'journal.local',journalWindowTarget,payload,['Original Journal actor/window/view, scene time and exact source graph or Files.','Local .jjournal custom JSON format; native Apple Journal archives are not claimed. App access lock is not encryption.'],['Actual rich entry edits, original scene attachments, local print/share/Files destinations.'],['journal'],[],journalWindowTarget)));
