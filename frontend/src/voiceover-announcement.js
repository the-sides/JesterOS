const punctuation={'.':'period',',':'comma','!':'exclamation mark','?':'question mark',':':'colon',';':'semicolon','(':'left parenthesis',')':'right parenthesis','[':'left bracket',']':'right bracket','{':'left brace','}':'right brace','/':'slash','\\':'backslash','-':'hyphen','_':'underscore','@':'at sign','#':'number sign','&':'ampersand','*':'asterisk','+':'plus','=':'equals','"':'quotation mark',"'":'apostrophe'};
export function voiceOverAnnouncement(text,settings,{role='',hint=''}={}){
 let output=text;if(settings.voiceOverPunctuation==='none')output=output.replace(/[.,!?:;()[\]{}\/\\\-_@#&*+="']/gu,' ');else if(settings.voiceOverPunctuation==='all')output=output.replace(/[.,!?:;()[\]{}\/\\\-_@#&*+="']/gu,char=>` ${punctuation[char]} `);
 if(role&&settings.voiceOverVerbosity!=='low')output+=`. ${role}.`;if(hint&&settings.voiceOverHints&&settings.voiceOverVerbosity==='high')output+=` ${hint}`;return output.slice(0,8192);
}
