import {uid,escapeHTML as esc,initials,addresses,bytes,visibleMessages,groupThreads,validateSnapshot} from './modules/core.js';
import {readStore,writeStore,deriveKey,seal,unseal,encode64,decode64} from './modules/vault.js';
import {sampleState} from './modules/demo.js';
import {JMAPClient} from './modules/jmap.js';
import {DesktopClient} from './modules/desktop.js';
import {icon,hydrateIcons} from './modules/icons.js';

const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
let state, adapter=null, vaultKey=null, vaultSalt=null, envelope=null, folder='inbox', activeId=null, query='', unreadOnly=false;
let selected=new Set(), draftId=null, draftFiles=[], draftReplyId=null, draftTimer, toastTimer, toastAction, installPrompt=null, pendingSend=null, syncing=false;
let saveChain=Promise.resolve(), promptHandler, offset=0, hasMore=false, ephemeralSample=new URLSearchParams(location.search).has('sample');
let searchTimer, lastFocus, sessionEpoch=0,sortBy='date',sortAscending=false;
const folders=[['inbox','Inbox','inbox'],['starred','Starred','star'],['drafts','Drafts','draft'],['sent','Sent','send'],['archive','Archive','archive'],['snoozed','Snoozed','clock'],['spam','Spam','shield'],['trash','Trash','trash']];
const formatTime=date=>new Date(date).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});
function dateLabel(date) {
  const d=new Date(date), today=new Date();
  return d.toDateString()===today.toDateString()?formatTime(d):d.toLocaleDateString([], {day:'numeric',month:'short'});
}
function toast(message, action, label='Undo', duration=6500) {
  clearTimeout(toastTimer); $('#toast-message').textContent=message; $('#toast').hidden=false;
  $('#application-status-text').textContent=message;
  toastAction=action; $('#toast-action').hidden=!action; $('#toast-action').textContent=label;
  if (duration) toastTimer=setTimeout(()=>{$('#toast').hidden=true;toastAction=null;$('#application-status-text').textContent=state?'Ready':'Workspace locked';},duration);
}
$('#toast-action').onclick=async()=>{const action=toastAction;$('#toast').hidden=true;toastAction=null;if(action)try{await action();}catch(e){toast(e.message);}};
function dialogOpen(id) { lastFocus=document.activeElement; if(!$(id).open) $(id).showModal(); }
function dialogClose(id) { $(id).close(); lastFocus?.focus?.(); }
function promptValue(title,label,help,handler,type='text') {
  $('#prompt-title').textContent=title;$('#prompt-label').textContent=label;$('#prompt-help').textContent=help;$('#prompt-error').textContent='';$('#prompt-input').value='';$('#prompt-input').type=type;$('#prompt-input').minLength=type==='password'?12:1;promptHandler=handler;dialogOpen('#prompt-dialog');
}
$('#prompt-form').onsubmit=async e=>{e.preventDefault();try{await promptHandler($('#prompt-input').value);dialogClose('#prompt-dialog');}catch(err){$('#prompt-error').textContent=err.message;}};
$$('[data-close]').forEach(el=>el.onclick=()=>dialogClose('#'+el.dataset.close));
function snapshot() { return JSON.parse(JSON.stringify(state)); }
function persist() {
  if(!state || ephemeralSample) return Promise.resolve();
  const value=snapshot(), key=vaultKey, salt=vaultSalt;
  saveChain=saveChain.catch(()=>{}).then(async()=>{
    if(key) {envelope=await seal(value,key,salt);await writeStore(envelope);}
    else if(value.mode==='demo') await writeStore(value);
    else throw new Error('Private mail requires an unlocked encrypted vault.');
  });
  saveChain.catch(e=>toast('Changes could not be saved on this device: '+e.message,undefined,'',12000));
  return saveChain;
}
function current() { return state?.messages.find(m=>m.id===activeId); }
function threadMembers(m) { return m?state.messages.filter(x=>(x.threadId || x.id)===(m.threadId || m.id) && (m.folder==='trash'?x.folder==='trash':x.folder!=='trash')).sort((a,b)=>new Date(a.date)-new Date(b.date)):[]; }
function currentList() {
  const list=groupThreads(visibleMessages(state.messages,{folder,query,unreadOnly}));
  return list.sort((a,b)=>{
    const value=sortBy==='subject'?a.subject.localeCompare(b.subject):sortBy==='sender'?(a.from.name||a.from.email).localeCompare(b.from.name||b.from.email):new Date(a.date)-new Date(b.date);
    return sortAscending?value:-value;
  });
}
function renderNav() {
  $('#folder-nav').innerHTML=folders.map(([key,name,ico])=>{
    const count=key==='inbox'?state.messages.filter(m=>m.folder==='inbox' && !m.read && !(m.snoozeUntil>Date.now())).length:key==='drafts'?state.messages.filter(m=>m.folder==='drafts').length:0;
    return `<button class="nav-item ${folder===key&&!query?'active':''}" data-folder="${key}" ${folder===key&&!query?'aria-current="page"':''}>${icon(ico)}<span>${name}</span>${count?`<span class="nav-count">${count}</span>`:''}</button>`;
  }).join('');
  const labels=[...new Set([...(state.collections || ['Work','Personal','Reading']),...state.messages.flatMap(m=>m.labels || [])])];
  $('#label-nav').innerHTML=labels.map((name,i)=>`<button class="nav-item ${folder==='label:'+name&&!query?'active':''}" data-folder="label:${esc(name)}"><span class="label-dot ${['work','personal','reading'][i%3]}"></span><span>${esc(name)}</span></button>`).join('');
}
function renderList() {
  const list=currentList(), title=query?'Search results':folder.startsWith('label:')?folder.slice(6):folders.find(f=>f[0]===folder)?.[1] || 'All mail';
  $('#folder-title').innerHTML=esc(title)+`<span class="count-pill">${list.length}</span>`;
  $('#today-label').textContent=query?'ACROSS YOUR CACHED MAIL':new Date().toLocaleDateString('en',{weekday:'long',day:'numeric',month:'long'}).toUpperCase();
  $('#list-total').textContent=list.length+' conversation'+(list.length===1?'':'s');
  $('#all-tab').classList.toggle('active',!unreadOnly);$('#all-tab').setAttribute('aria-pressed',String(!unreadOnly));
  $('#focus-tab').classList.toggle('active',unreadOnly);$('#focus-tab').setAttribute('aria-pressed',String(unreadOnly));
  $('#message-list').innerHTML=list.map(m=>{
    const active=threadMembers(current()).some(x=>x.id===m.id);
    const sender=m.folder==='sent'||m.folder==='drafts'?'You':m.from.name || m.from.email;
    return `<article class="message-row ${m.read?'':'unread'} ${active?'selected':''}" data-message="${esc(m.id)}"><input class="row-check" type="checkbox" aria-label="Select ${esc(m.subject)}" data-select="${esc(m.id)}" ${selected.has(m.id)?'checked':''}><button class="star-button ${m.starred?'starred':''}" data-star="${esc(m.id)}" aria-label="${m.starred?'Unstar':'Star'} ${esc(m.subject)}" aria-pressed="${m.starred}">${icon('star')}</button><button class="message-open" data-open="${esc(m.id)}" aria-label="Open ${esc(m.subject)} from ${esc(sender)}"><span class="message-subject">${icon(m.folder==='drafts'?'draft':'mail')}<span class="subject-text">${esc(m.subject || '(No subject)')}</span>${m.members.length>1?`<span class="thread-count">(${m.members.length})</span>`:''}</span><span class="message-sender">${esc(sender)}</span><time class="message-time" datetime="${esc(m.date)}">${esc(new Date(m.date).toLocaleString([],{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}))}</time><span class="message-badges">${m.attachments?.length?icon('paperclip'):''}${m.snoozeUntil>Date.now()?icon('clock'):''}</span></button></article>`;
  }).join('') || `<div class="empty-list"><h3>${query?'No matching messages.':unreadOnly?'No unread messages.':'No messages in this folder.'}</h3><p>${query?'Search covers messages cached on this device.':'Use Get Mail to check your connected account.'}</p></div>`;
  $('#bulk-bar').hidden=!selected.size;$('#selection-count').textContent=selected.size+' selected';
  $('#load-more').hidden=!(adapter && hasMore);
  document.title=title+' · Mail Wizard';
  $('#window-title').textContent=title+' - Mail Wizard';$('#folder-location').textContent=(state.mode==='demo'?'Local Folders':state.account.email)+' / '+title;
  $('#application-unread').textContent='Unread: '+list.filter(m=>!m.read).length;$('#application-total').textContent='Total: '+list.length;
  $$('[data-sort]').forEach(b=>{const label={subject:'Subject',sender:'Correspondents',date:'Date'}[b.dataset.sort];b.innerHTML=label+(b.dataset.sort===sortBy?'<span>'+(sortAscending?'▲':'▼')+'</span>':'');b.setAttribute('aria-label','Sort by '+label.toLowerCase()+(b.dataset.sort===sortBy?(sortAscending?', ascending':', descending'):''));});
  $$('[data-command]').forEach(b=>b.disabled=!current());
}
function actionButton(action,ico,label,extra='') {return `<button class="icon-button ${extra}" data-action="${action}" title="${label}" aria-label="${label}">${icon(ico)}</button>`;}
function renderReader() {
  const message=current();
  if(!message) {$('#reader').innerHTML='<div class="empty-reader"><span class="empty-illustration">'+icon('mail')+'</span><h2>Mail Wizard</h2><p>Select a message to read it.</p></div>';return;}
  const members=threadMembers(message), last=members[members.length-1];
  $('#reader').innerHTML=`<div class="reader-toolbar">${actionButton('back','left','Back to messages','back-button')}${actionButton('archive','archive','Archive message')}${actionButton(message.read?'unread':'read','mail',message.read?'Mark unread':'Mark read')}${actionButton('snooze','clock','Snooze on this device')}<span class="toolbar-divider"></span>${actionButton('trash','trash','Move to trash')}${actionButton('label','tag','Add to a local collection')}<div class="toolbar-right"><span>${members.length>1?members.length+' messages':'1 message'}</span>${actionButton('previous','left','Previous message')}${actionButton('next','right','Next message')}</div></div><div class="reader-content"><div class="reader-labels">${(message.labels || []).map(l=>`<span class="mini-label">${esc(l)}</span>`).join('')}${message.snoozeUntil>Date.now()?'<span class="mini-label">Snoozed until '+esc(new Date(message.snoozeUntil).toLocaleString())+'</span>':''}</div><h2>${esc(message.subject || '(No subject)')}</h2>${members.map(m=>`<article class="message-card"><header class="sender-details"><div class="avatar">${esc(initials(m.from.name || m.from.email))}</div><div class="sender-info"><strong>${esc(m.from.name || m.from.email)}</strong><span>${esc(m.from.email)}<br>to ${esc((m.to || []).map(a=>a.name || a.email).join(', '))}${m.cc?.length?' · cc '+esc(m.cc.map(a=>a.email).join(', ')):''}</span></div><time class="sender-date" datetime="${esc(m.date)}">${esc(new Date(m.date).toLocaleDateString([],{day:'numeric',month:'short'}))} · ${esc(formatTime(m.date))}</time></header><div class="message-body">${esc(m.body)}</div>${m.bodyTruncated?'<p class="status-warning">This long message is truncated in the local cache. Open the complete message with your provider.</p>':''}${m.attachments?.length?`<div class="attachments">${m.attachments.map((a,i)=>`<button class="attachment" data-download="${i}" data-source="${esc(m.id)}">${icon('file')}<span><strong>${esc(a.name || 'Attachment')}</strong><small>${bytes(a.size || 0)} · Download</small></span>${icon('download')}</button>`).join('')}</div>`:''}</article>`).join('')}<div class="reader-bottom">${message.folder==='drafts'&&message.localDraft?`<button class="reply-button" data-action="edit-draft">${icon('draft')} Continue writing</button>`:`<button class="reply-button" data-action="reply">${icon('reply')} Reply</button><button data-action="forward">${icon('forward')} Forward</button>`}${message.folder==='trash'?'<button data-action="restore">Restore</button>':''}${actionButton('export','download','Export message as EML')}</div><p class="reader-footnote">${icon('shield')} Plain text view. Remote images and email scripts stay out of your inbox.</p></div>`;
}
function render() {
  if(!state) return;
  $('#sample-banner').hidden=state.mode!=='demo';
  $('#account-name').textContent=state.account.name || state.account.email;
  $('#tree-account-name').textContent=state.mode==='demo'?'Local Folders':state.account.email;
  $('#account-status').textContent=state.mode==='demo'?'Sample inbox':adapter?'Connected account':'Offline · unlock to reconnect';
  $('.account-avatar').textContent=initials(state.account.name || state.account.email);
  $('#connection-status').innerHTML='<span></span>'+(!navigator.onLine?'Offline':state.mode==='demo'?'Local workspace':adapter?'Connected directly':'Cached mail');
  renderNav();renderList();renderReader();
}
async function changeMessages(messages,changes,{undo=false,label='Updated'}={}) {
  if(!state)return;
  const previous=[];
  for(const m of messages) {
    const remoteChanges=Object.fromEntries(Object.entries(changes).filter(([k])=>['read','starred','folder'].includes(k)));
    if(m.remoteId && Object.keys(remoteChanges).length && !adapter) throw new Error('Reconnect to your provider before changing this message.');
    const before={};for(const k of Object.keys(changes))before[k]=m[k]??null;
    if(adapter && m.remoteId) await adapter.update(m,remoteChanges);
    previous.push({id:m.id,before});Object.assign(m,changes);
    await persist();
  }
  render();
  if(undo)toast(label,async()=>{for(const old of previous){const m=state.messages.find(x=>x.id===old.id);if(m)await changeMessages([m],old.before);}toast('Change undone.');});
}
async function openMessage(id) {
  const m=state.messages.find(x=>x.id===id);if(!m)return;
  activeId=id;$('.mail-workspace').classList.add('reading');render();
  const unread=threadMembers(m).filter(x=>!x.read);
  if(unread.length)try{await changeMessages(unread,{read:true});}catch(e){toast(e.message);}
}
async function navigate(key) {
  folder=key;query='';$('#search').value='';selected.clear();activeId=null;unreadOnly=false;offset=0;$('.sidebar').classList.remove('open');$('.mail-workspace').classList.remove('reading');render();
  if(state.mode==='imap' && adapter && ['inbox','sent','archive','trash','spam'].includes(key))await refresh(false);
}
$('#folder-nav').onclick=e=>{const b=e.target.closest('[data-folder]');if(b)navigate(b.dataset.folder).catch(err=>toast(err.message));};
$('#label-nav').onclick=e=>{const b=e.target.closest('[data-folder]');if(b)navigate(b.dataset.folder);};
$('#message-list').onclick=e=>{const star=e.target.closest('[data-star]'), open=e.target.closest('[data-open]');if(star){const m=state.messages.find(m=>m.id===star.dataset.star);changeMessages([m],{starred:!m.starred}).catch(e=>toast(e.message));}else if(open)openMessage(open.dataset.open);};
$('#message-list').onchange=e=>{if(e.target.dataset.select){const id=e.target.dataset.select;e.target.checked?selected.add(id):selected.delete(id);renderList();}};
$('#clear-selection').onclick=()=>{selected.clear();renderList();};
$$('[data-bulk]').forEach(el=>el.onclick=async()=>{const list=currentList().filter(t=>selected.has(t.id)).flatMap(t=>t.members);try{await changeMessages(list,el.dataset.bulk==='read'?{read:true}:{folder:el.dataset.bulk},{undo:true,label:list.length+' messages updated'});selected.clear();renderList();}catch(e){render();toast('Some messages could not be updated: '+e.message);}});
$('#search').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{query=$('#search').value.trim();selected.clear();renderNav();renderList();},150);};
$('#all-tab').onclick=()=>{unreadOnly=false;renderList();};$('#focus-tab').onclick=()=>{unreadOnly=true;renderList();};
$('#new-label').onclick=()=>promptValue('New Tag','Tag name','Tags are stored on this device.',async value=>{const name=value.trim();if(!name)throw new Error('Enter a tag name.');state.collections=[...new Set([...(state.collections || ['Work','Personal','Reading']),name])];await persist();renderNav();});
$('#reader').onclick=async e=>{
  const action=e.target.closest('[data-action]')?.dataset.action, download=e.target.closest('[data-download]');
  try {
    if(download){const m=state.messages.find(x=>x.id===download.dataset.source);await downloadAttachment(m,m.attachments[Number(download.dataset.download)]);return;}
    if(!action)return;const m=current(), members=threadMembers(m);
    if(action==='back'){$('.mail-workspace').classList.remove('reading');return;}
    if(action==='next'||action==='previous'){stepMessage(action==='next'?1:-1);return;}
    if(action==='reply'||action==='forward'){await openCompose(m,action);return;}
    if(action==='edit-draft'){await openCompose(m,'draft');return;}
    if(action==='export'){exportMessage(m);return;}
    if(action==='label'){promptValue('Tag Message','Tag name','Stored locally. It does not change labels on your provider.',async name=>{name=name.trim();if(!name)throw new Error('Enter a name.');for(const msg of members)msg.labels=[...new Set([...(msg.labels || []),name])];await persist();render();});return;}
    if(action==='snooze'){if(m.snoozeUntil>Date.now())await changeMessages(members,{snoozeUntil:null},{undo:true,label:'Returned to your inbox'});else promptValue('Snooze Message','Date and time','Snoozing hides this conversation locally until the chosen time. It does not schedule mail or change other email apps.',async value=>{const date=new Date(value);if(!Number.isFinite(date.getTime())||date.getTime()<Date.now())throw new Error('Choose a date in the future.');await changeMessages(members,{snoozeUntil:date.getTime()},{undo:true,label:'Snoozed on this device'});},'datetime-local');return;}
    if(action==='archive'||action==='trash'||action==='restore')await changeMessages(members,{folder:action==='restore'?'inbox':action},{undo:true,label:action==='trash'?'Moved to trash':action==='restore'?'Restored to inbox':'Archived'});
    if(action==='read'||action==='unread')await changeMessages(members,{read:action==='read'},{undo:true,label:action==='read'?'Marked as read':'Marked as unread'});
  }catch(err){render();toast(err.message);}
};
function stepMessage(direction) {const list=currentList();const index=list.findIndex(x=>x.members.some(m=>m.id===activeId));const next=list[index+direction];if(next)openMessage(next.id);}
async function refresh(more=false) {
  if(syncing)return;
  if(!adapter){if(state.mode==='demo'){render();toast('Your sample workspace is up to date.');}else{toast('Reconnect to refresh your mail.');openSettings();}return;}
  const epoch=sessionEpoch, workspace=state;
  syncing=true;$('#refresh').classList.add('spin');$('#load-more').disabled=true;
  try {
    const position=more?offset:0, incoming=state.mode==='imap'?await adapter.sync(['inbox','sent','archive','trash','spam'].includes(folder)?folder:'inbox',position):await adapter.sync(position);
    if(epoch!==sessionEpoch||state!==workspace)return;
    const pageSize=incoming.length;
    if(state.mode==='jmap' && !more) {
      const seenIds=new Set(incoming.map(m=>m.remoteId)),ids=state.messages.filter(m=>m.remoteId&&!seenIds.has(m.remoteId)).map(m=>m.remoteId);
      if(ids.length){const result=await adapter.reconcile(ids);if(epoch!==sessionEpoch||state!==workspace)return;incoming.push(...result.messages);const removed=new Set(result.removed);state.messages=state.messages.filter(m=>!removed.has(m.remoteId));}
    }
    for(const m of incoming){const old=state.messages.find(x=>x.id===m.id);if(old){m.labels=old.labels || [];m.snoozeUntil=old.snoozeUntil;} }
    // Keep local drafts and cached older messages; never infer a remote deletion from one page.
    const received=new Set(incoming.map(m=>m.id));
    state.messages=[...state.messages.filter(m=>!received.has(m.id)&&!incoming.some(n=>
      (m.remoteId&&n.remoteId&&m.remotePath===n.remotePath&&m.remoteId===n.remoteId&&m.uidValidity===n.uidValidity) ||
      (m.localSent&&m.messageId?.[0]&&n.messageId?.[0]===m.messageId[0]))),...incoming];
    offset=position+pageSize;hasMore=state.mode==='imap'?adapter.hasMore:offset<(adapter.lastQuery?.total ?? Infinity)&&pageSize>0;
    await persist();render();
  } catch(e){if(epoch===sessionEpoch)toast(e.message,undefined,'',12000);}
  finally{syncing=false;$('#refresh').classList.remove('spin');$('#load-more').disabled=false;}
}
$('#refresh').onclick=()=>refresh();$('#load-more').onclick=()=>refresh(true);

function composerValues() {
  return {id:draftId || uid(),threadId:draftId || uid(),folder:'drafts',localDraft:true,from:state.account,to:$('#compose-to').value,cc:$('#compose-cc').value,bcc:$('#compose-bcc').value,subject:$('#compose-subject').value,body:$('#compose-body').value,attachments:draftFiles,date:new Date().toISOString(),read:true,starred:false,labels:[],replyMessageId:draftReplyId};
}
async function saveDraft() {
  clearTimeout(draftTimer);if(!state||!$('#compose-dialog').open)return;
  const draft=composerValues();draftId=draft.id;draft.threadId=draft.id;
  // Address fields can be incomplete while typing. Store their raw values separately.
  draft.rawTo=draft.to;draft.rawCc=draft.cc;draft.rawBcc=draft.bcc;
  try{draft.to=addresses(draft.to);}catch{draft.to=[];}try{draft.cc=addresses(draft.cc);}catch{draft.cc=[];}try{draft.bcc=addresses(draft.bcc);}catch{draft.bcc=[];}
  const index=state.messages.findIndex(m=>m.id===draft.id);if(index>=0)state.messages[index]=draft;else state.messages.push(draft);
  $('#draft-status').textContent='Saving draft…';await persist();$('#draft-status').textContent='Draft saved on this device';renderNav();
}
async function openCompose(message=null, kind='new') {
  if(pendingSend){toast('A message is already waiting to send.',cancelQueuedSend,'Undo send',0);return;}
  draftId=kind==='draft'?message.id:uid();draftFiles=kind==='draft'?[...(message.attachments || [])]:[];draftReplyId=kind==='reply'?message.messageId:null;
  $('#compose-title').textContent='Write: '+(message?.subject || '(no subject)');
  $('#compose-to').value=kind==='draft'?message.rawTo || message.to.map(a=>a.email).join(', '):kind==='reply'?(message.from.email===state.account.email?message.to[0]?.email || '':message.from.email):'';
  $('#compose-cc').value=kind==='draft'?message.rawCc || '':'';$('#compose-bcc').value=kind==='draft'?message.rawBcc || '':'';
  $('#compose-subject').value=kind==='draft'?message.subject:kind==='reply'?(/^(re:)/i.test(message.subject)?message.subject:'Re: '+message.subject):kind==='forward'?'Fwd: '+message.subject:'';
  const signature=state.settings.signature?'\n\n'+state.settings.signature:'';
  $('#compose-body').value=kind==='draft'?message.body:kind==='reply'?signature+'\n\nOn '+new Date(message.date).toLocaleString()+', '+(message.from.name || message.from.email)+' wrote:\n'+message.body.split('\n').map(l=>'> '+l).join('\n'):kind==='forward'?signature+'\n\n---------- Forwarded message ----------\nFrom: '+message.from.email+'\nDate: '+new Date(message.date).toLocaleString()+'\nSubject: '+message.subject+'\n\n'+message.body:signature;
  $('#cc-fields').hidden=kind!=='draft'||!($('#compose-cc').value || $('#compose-bcc').value);
  $('#send-button').disabled=false;$('#send-button').innerHTML=(state.mode==='demo'?'Send sample':'Send message')+icon('send');
  renderDraftFiles();dialogOpen('#compose-dialog');setTimeout(()=>$(kind==='reply'?'#compose-body':'#compose-to').focus(),0);
}
function renderDraftFiles() {$('#compose-attachments').innerHTML=draftFiles.map((f,i)=>`<span class="compose-file"><span>${esc(f.name)} · ${bytes(f.size)}</span><button type="button" data-remove-file="${i}" aria-label="Remove ${esc(f.name)}">×</button></span>`).join('');}
$('#compose-button').onclick=()=>openCompose();
$('#close-compose').onclick=async()=>{try{await saveDraft();dialogClose('#compose-dialog');render();toast('Draft saved on this device.');}catch{}};
$('#compose-dialog').addEventListener('cancel',e=>{e.preventDefault();$('#close-compose').click();});
$('#compose-form').oninput=()=>{clearTimeout(draftTimer);draftTimer=setTimeout(()=>saveDraft().catch(()=>{}),500);$('#draft-status').textContent='Saving draft…';$('#compose-title').textContent='Write: '+($('#compose-subject').value || '(no subject)');};
$('#show-cc').onclick=()=>{$('#cc-fields').hidden=!$('#cc-fields').hidden;};
$('#attach-button').onclick=()=>$('#file-input').click();
async function addFiles(files) {
  const total=draftFiles.reduce((n,f)=>n+f.size,0)+[...files].reduce((n,f)=>n+f.size,0);
  if(total>25*1024*1024)throw new Error('Keep attachments under 25 MB in total. Your provider may use a lower limit.');
  if(draftFiles.length+files.length>20)throw new Error('Attach up to 20 files per message.');
  for(const file of files)draftFiles.push({name:file.name,type:file.type || 'application/octet-stream',size:file.size,data:encode64(new Uint8Array(await file.arrayBuffer()))});
  renderDraftFiles();await saveDraft();
}
$('#file-input').onchange=async()=>{try{await addFiles($('#file-input').files);}catch(e){toast(e.message);}$('#file-input').value='';};
$('#compose-attachments').onclick=async e=>{const b=e.target.closest('[data-remove-file]');if(b){draftFiles.splice(Number(b.dataset.removeFile),1);renderDraftFiles();await saveDraft();}};
$('#compose-dialog').ondragover=e=>{e.preventDefault();};$('#compose-dialog').ondrop=async e=>{e.preventDefault();if(e.dataTransfer.files.length)try{await addFiles(e.dataTransfer.files);}catch(err){toast(err.message);}};
$('#discard-draft').onclick=async()=>{clearTimeout(draftTimer);const m=state.messages.find(m=>m.id===draftId);if(m){m.folder='trash';await persist();}dialogClose('#compose-dialog');render();toast('Draft moved to trash.',async()=>{if(m){m.folder='drafts';await persist();render();}});};
async function queueSend(e) {
  e.preventDefault();if(pendingSend)return;
  try {
    const to=addresses($('#compose-to').value),cc=addresses($('#compose-cc').value),bcc=addresses($('#compose-bcc').value);
    if(!to.length)throw new Error('Add at least one recipient.');
    if(state.mode!=='demo' && !adapter)throw new Error('Connect your mail provider before sending.');
    await saveDraft();
    const id=draftId, draft={...state.messages.find(m=>m.id===id),to,cc,bcc,files:draftFiles.map(f=>new File([decode64(f.data)],f.name,{type:f.type}))};
    const seconds=Number(state.settings.undoSeconds || 8);
    pendingSend={draft,id,remaining:seconds,sending:false,timer:null};dialogClose('#compose-dialog');render();
    const updateCountdown=()=>{if(!pendingSend)return;toast((state.mode==='demo'?'Sample message':'Message')+' sends in '+pendingSend.remaining+'s. Keep this app open.',cancelQueuedSend,'Undo send',0);};
    updateCountdown();pendingSend.timer=setInterval(async()=>{if(!pendingSend)return;pendingSend.remaining--;if(pendingSend.remaining>0){updateCountdown();return;}clearInterval(pendingSend.timer);pendingSend.sending=true;toast(state.mode==='demo'?'Saving sample message…':'Handing your message to your provider…',undefined,'',0);
      try {
        const queued=pendingSend,result=state.mode==='demo'?{id:uid()}:await adapter.send(queued.draft);
        state.messages=state.messages.filter(m=>m.id!==queued.id);
        state.messages.push({...queued.draft,...result,files:undefined,id:result.id || uid(),threadId:queued.draft.threadId,folder:'sent',localDraft:false,localSent:true,date:new Date().toISOString(),messageId:result.messageId?[result.messageId]:undefined,rawTo:undefined,rawCc:undefined,rawBcc:undefined});
        pendingSend=null;await persist();render();toast(state.mode==='demo'?'Sample message saved to Sent. No email was delivered.':'Your provider accepted the message.'+(result.warning?' '+result.warning:''),undefined,'',12000);
      }catch(err){pendingSend=null;render();toast('Sending was not confirmed: '+err.message+' Your local draft is kept. Check Sent before retrying.',undefined,'',18000);}
    },1000);
  }catch(err){toast(err.message);}
}
async function cancelQueuedSend() {
  if(!pendingSend)return;
  if(pendingSend.sending){toast('The message is already with your provider and cannot be recalled.');return;}
  clearInterval(pendingSend.timer);const draft=state.messages.find(m=>m.id===pendingSend.id);pendingSend=null;toast('Send cancelled. Your draft is safe.');if(draft)await openCompose(draft,'draft');
}
$('#compose-form').onsubmit=queueSend;
window.addEventListener('beforeunload',e=>{if(pendingSend){e.preventDefault();e.returnValue='A message is waiting to send.';}});
function downloadBlob(blob,name) {
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=String(name).replace(/[\x00-\x1f/\\]/g,'_').slice(0,180);document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
async function downloadAttachment(message,attachment) {
  if(attachment.data)downloadBlob(new Blob([decode64(attachment.data)],{type:attachment.type}),attachment.name);
  else if(adapter)downloadBlob(await adapter.attachment(message,attachment),attachment.name || 'attachment');
  else throw new Error('Connect your provider to download this attachment.');
}
function exportMessage(m) {
  const clean=value=>String(value || '').replace(/[\r\n]/g,' ');
  const subject='=?UTF-8?B?'+encode64(new TextEncoder().encode(m.subject))+'?=';
  const data=['From: '+clean(m.from.email),'To: '+m.to.map(a=>clean(a.email)).join(', '),'Date: '+new Date(m.date).toUTCString(),'Subject: '+subject,'MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',encode64(new TextEncoder().encode(m.body)).match(/.{1,76}/g)?.join('\r\n') || ''].join('\r\n');
  downloadBlob(new Blob([data],{type:'message/rfc822'}),(m.subject || 'message')+'.eml');toast('Plain-text message exported. Download attachments separately.');
}

function applyTheme(theme) {document.documentElement.dataset.theme=theme;localStorage.setItem('mail-wizard-theme',theme);$('#theme-toggle').innerHTML=icon(theme==='dark'?'sun':'moon');$('#theme-toggle').setAttribute('aria-label',theme==='dark'?'Switch to light mode':'Switch to dark mode');}
applyTheme(localStorage.getItem('mail-wizard-theme') || 'light');
$('#theme-toggle').onclick=()=>applyTheme(document.documentElement.dataset.theme==='dark'?'light':'dark');
$('#mobile-menu').onclick=()=>$('.sidebar').classList.toggle('open');
function openSettings(tab='account') {
  $('#signature').value=state.settings.signature || '';$('#undo-seconds').value=state.settings.undoSeconds || 8;
  $('#imap-option').disabled=!window.mailWizard;
  if(!window.mailWizard)$('#imap-option').textContent='IMAP + SMTP · desktop app only';
  $('#connected-account').hidden=!state.connection;
  $('#connected-account').innerHTML=state.connection?`<div class="connected-card"><strong>${esc(state.account.email)}</strong><p>${esc(state.connection.type.toUpperCase())} · encrypted on this device · ${adapter?'connected':'offline'}</p><button class="secondary-button" id="reconnect-account">Reconnect</button></div>`:'';
  $('#connect-form').hidden=!!state.connection;$('#vault-passphrase').required=!vaultKey;
  $('#vault-passphrase').parentElement.querySelector('label[for=vault-passphrase]').hidden=!!vaultKey;$('#vault-passphrase').hidden=!!vaultKey;
  $('#lock-vault').disabled=!vaultKey;$('#lock-vault').textContent=vaultKey?'Lock workspace':'Sample workspace does not use a vault';
  showSettingsTab(tab);dialogOpen('#settings-dialog');
}
function showSettingsTab(tab) {$$('[data-settings-tab]').forEach(b=>b.classList.toggle('active',b.dataset.settingsTab===tab));$$('.settings-panel').forEach(p=>p.hidden=p.id!=='settings-'+tab);}
$$('[data-settings-tab]').forEach(b=>b.onclick=()=>showSettingsTab(b.dataset.settingsTab));
$('#settings-button').onclick=()=>openSettings();$('#account-button').onclick=()=>openSettings();$('#connect-banner').onclick=()=>openSettings();
$('#connected-account').onclick=async e=>{if(e.target.id==='reconnect-account')try{await reconnect();toast('Connected to your provider.');}catch(err){toast(err.message);}};
$('#provider-type').onchange=()=>{const imap=$('#provider-type').value==='imap';$('#imap-fields').hidden=!imap;$('#jmap-fields').hidden=imap;$('#session-url').required=!imap;};
$('#imap-preset').onchange=()=>{
  const presets={gmail:['imap.gmail.com','smtp.gmail.com'],icloud:['imap.mail.me.com','smtp.mail.me.com'],fastmail:['imap.fastmail.com','smtp.fastmail.com']};
  const p=presets[$('#imap-preset').value];if(p){$('#imap-host').value=p[0];$('#smtp-host').value=p[1];$('#imap-port').value='993';$('#smtp-port').value=$('#imap-preset').value==='icloud'?'587':'465';}
};
async function createAdapter(connection) {
  const client=connection.type==='jmap'?new JMAPClient(connection.sessionURL,connection.token):new DesktopClient();
  const info=connection.type==='jmap'?await client.connect():await client.connect(connection);
  return {client,info};
}
$('#connect-form').onsubmit=async e=>{
  e.preventDefault();if(pendingSend){$('#connect-error').textContent='Finish or cancel the pending message first.';return;}
  if(ephemeralSample){$('#connect-error').textContent='This sample is temporary. Open your main workspace from the About page to connect an account.';return;}
  $('#connect-submit').disabled=true;$('#connect-error').textContent='';
  let created;
  try {
    const type=$('#provider-type').value;
    const connection=type==='jmap'?{type,sessionURL:$('#session-url').value,token:$('#api-token').value.trim()}:{type,email:$('#imap-email').value.trim(),password:$('#imap-password').value,imapHost:$('#imap-host').value.trim(),imapPort:Number($('#imap-port').value),smtpHost:$('#smtp-host').value.trim(),smtpPort:Number($('#smtp-port').value)};
    if(type==='jmap'&&!connection.token)throw new Error('Enter a provider API token.');
    if(type==='imap'&&(!window.mailWizard||!connection.password||!connection.email))throw new Error('Use the desktop app and enter your email address and provider app password.');
    const salt=crypto.getRandomValues(new Uint8Array(16)),key=await deriveKey($('#vault-passphrase').value,salt);
    created=await createAdapter(connection);
    const incoming=type==='jmap'?await created.client.sync():await created.client.sync('inbox');
    const identity=created.info.identities?.[0];
    const account={name:identity?.name || created.info.name || connection.email || 'Your account',email:identity?.email || created.info.email || connection.email || ''};
    state={schema:1,mode:type,account,connection,messages:incoming,settings:{signature:'',undoSeconds:8},collections:['Work','Personal','Reading'],contacts:[]};
    adapter=created.client;vaultKey=key;vaultSalt=salt;offset=incoming.length;hasMore=type==='imap'?adapter.hasMore:offset<(adapter.lastQuery?.total || 0);folder='inbox';activeId=incoming[0]?.id || null;selected.clear();
    await persist();$('#api-token').value='';$('#imap-password').value='';$('#vault-passphrase').value='';dialogClose('#settings-dialog');render();toast('Connected directly. Your local workspace is encrypted.');
  }catch(err){$('#connect-error').textContent=err.message;}
  finally{$('#connect-submit').disabled=false;}
};
async function reconnect() {
  if(!state.connection)return;
  const epoch=sessionEpoch,workspace=state,{client}=await createAdapter(state.connection);
  if(epoch!==sessionEpoch||workspace!==state){await window.mailWizard?.disconnect();return;}
  adapter=client;await refresh();render();
}
$('#save-preferences').onclick=async()=>{state.settings.signature=$('#signature').value;state.settings.undoSeconds=Number($('#undo-seconds').value);await persist();toast('Preferences saved.');};
$('#export-backup').onclick=async()=>{try{await persist();const value=vaultKey?await seal(snapshot(),vaultKey,vaultSalt):snapshot();downloadBlob(new Blob([JSON.stringify(value)],{type:'application/json'}),'mail-wizard-'+new Date().toISOString().slice(0,10)+'.mwbackup');toast(vaultKey?'Encrypted backup exported. Keep your passphrase safe.':'Sample workspace exported.');}catch(e){toast(e.message);}};
$('#import-backup').onclick=()=>$('#backup-input').click();
$('#backup-input').onchange=async()=>{
  const file=$('#backup-input').files[0];$('#backup-input').value='';if(!file)return;
  try {
    if(file.size>80*1024*1024)throw new Error('This backup exceeds the 80 MB import limit.');
    const data=JSON.parse(await file.text());if(data.format!=='mail-wizard-vault')throw new Error('Restore accepts encrypted Mail Wizard backups only.');
    promptValue('Restore Backup','Backup passphrase','This replaces the local workspace. If a workspace is already connected, export its backup first. Your provider is unchanged.',async pass=>{
      if(pendingSend)throw new Error('Finish or cancel the pending message first.');
      const opened=await unseal(data,pass);validateSnapshot(opened.value);await saveChain.catch(()=>{});
      sessionEpoch++;adapter=null;await window.mailWizard?.disconnect();state=opened.value;vaultKey=opened.key;vaultSalt=opened.salt;envelope=data;await persist();activeId=null;selected.clear();render();toast('Workspace restored. Reconnect to sync your mail.');
    },'password');
  }catch(e){toast(e.message);}
};
$('#demo-reset').onclick=()=>{if(state.mode!=='demo'){toast('Your connected workspace is preserved. Open the sample from the About page in a web browser.');return;}state=sampleState();activeId='m2';folder='inbox';query='';selected.clear();persist();render();toast('A fresh sample workspace is ready.');};
$('#lock-vault').onclick=async()=>{
  if(pendingSend){toast('Finish or undo the pending message before locking.',cancelQueuedSend,'Undo send');return;}
  sessionEpoch++;
  await persist();adapter=null;await window.mailWizard?.disconnect();vaultKey=null;vaultSalt=null;state=null;draftFiles=[];draftId=null;activeId=null;selected.clear();$('#message-list').replaceChildren();$('#reader').replaceChildren();$('#account-name').textContent='Locked workspace';$('#account-status').textContent='Encrypted';$('#folder-nav').replaceChildren();$('#label-nav').replaceChildren();$('#search').value='';$('#folder-title').textContent='Workspace locked';$('#tree-account-name').textContent='Locked';$('#folder-location').textContent='';$('#window-title').textContent='Mail Wizard';$('#application-unread').textContent='Unread: 0';$('#application-total').textContent='Total: 0';$('#application-status-text').textContent='Workspace locked';$('#contact-list').replaceChildren();$('#contacts-search').value='';toastAction=null;clearTimeout(toastTimer);$('#list-total').textContent='';$('#connected-account').replaceChildren();query='';$('#toast').hidden=true;$('#compose-form').reset();$('#signature').value='';$('#compose-attachments').replaceChildren();dialogClose('#settings-dialog');$('#unlock-passphrase').value='';dialogOpen('#unlock-dialog');
};
$('#unlock-dialog').addEventListener('cancel',e=>e.preventDefault());
$('#unlock-form').onsubmit=async e=>{
  e.preventDefault();$('#unlock-error').textContent='';const button=$('#unlock-form button');button.disabled=true;
  try{const unlocked=await unseal(envelope,$('#unlock-passphrase').value);validateSnapshot(unlocked.value);state=unlocked.value;vaultKey=unlocked.key;vaultSalt=unlocked.salt;$('#unlock-passphrase').value='';dialogClose('#unlock-dialog');render();if(navigator.onLine)reconnect().catch(e=>toast('Cached mail is available. '+e.message,undefined,'',10000));}
  catch(err){$('#unlock-error').textContent=err.message;}finally{button.disabled=false;}
};
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;});
$('#install-app').onclick=async()=>{if(installPrompt){await installPrompt.prompt();installPrompt=null;}else{$('#install-help').textContent='Use Install app in Chrome or Edge. On iPhone or iPad, use Share → Add to Home Screen. The desktop source also includes Windows, macOS and Linux packaging.';}};
$('#shortcuts-button').onclick=()=>dialogOpen('#shortcuts-dialog');
document.addEventListener('keydown',e=>{
  if($('#compose-dialog').open && (e.ctrlKey||e.metaKey) && e.key==='Enter'){e.preventDefault();$('#compose-form').requestSubmit();return;}
  if($$('dialog[open]').length || !state)return;
  if(/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || e.ctrlKey || e.metaKey || e.altKey)return;
  if(e.key==='/'){e.preventDefault();$('#search').focus();}
  if(e.key.toLowerCase()==='c')openCompose();
  if(e.key.toLowerCase()==='j')stepMessage(1);if(e.key.toLowerCase()==='k')stepMessage(-1);
  if(e.key==='?')dialogOpen('#shortcuts-dialog');
  if(e.key.toLowerCase()==='e'&&current())changeMessages(threadMembers(current()),{folder:'archive'},{undo:true,label:'Archived'}).catch(e=>toast(e.message));
  if(e.key.toLowerCase()==='s'&&current())changeMessages([current()],{starred:!current().starred}).catch(e=>toast(e.message));
});
window.addEventListener('online',()=>{if(state?.connection)reconnect().catch(e=>toast(e.message));else render();});window.addEventListener('offline',()=>{render();toast('You are offline. Cached mail and local drafts are available.');});
setInterval(()=>{if(state&&adapter&&navigator.onLine&&document.visibilityState==='visible'&&!pendingSend)refresh();},120000);
setInterval(()=>{if(state?.messages.some(m=>m.snoozeUntil && m.snoozeUntil<=Date.now())){for(const m of state.messages)if(m.snoozeUntil<=Date.now())delete m.snoozeUntil;persist();render();}},60000);

// Application menus and the local address book share the existing mail actions.
function selectAllVisible() {
  const ids=currentList().map(m=>m.id),all=ids.length&&ids.every(id=>selected.has(id));
  selected=all?new Set():new Set(ids);renderList();
}
$('#select-all-messages').onclick=selectAllVisible;
$$('[data-sort]').forEach(button=>button.onclick=()=>{if(sortBy===button.dataset.sort)sortAscending=!sortAscending;else{sortBy=button.dataset.sort;sortAscending=sortBy!=='date';}renderList();});
function setLayout(layout) {document.documentElement.dataset.layout=layout;localStorage.setItem('mail-wizard-layout',layout);}
setLayout(localStorage.getItem('mail-wizard-layout') || 'stacked');
async function runCommand(command) {
  if(command.startsWith('go:'))return navigate(command.slice(3));
  if(command==='new')return openCompose();
  if(command==='refresh')return refresh();
  if(command==='settings')return openSettings();
  if(command==='preferences')return openSettings('preferences');
  if(command==='data')return openSettings('data');
  if(command==='contacts')return openContacts();
  if(command==='find'){$('#search').focus();return;}
  if(command==='select-all')return selectAllVisible();
  if(command==='undo'){if(toastAction)await toastAction();return;}
  if(command==='theme')return $('#theme-toggle').click();
  if(command==='stacked'||command==='side')return setLayout(command);
  if(command==='all'||command==='unread'){unreadOnly=command==='unread';renderList();return;}
  if(command==='shortcuts')return dialogOpen('#shortcuts-dialog');
  if(command==='about'){location.href='./about.html';return;}
  if(command==='print'){window.print();return;}
  if(command==='close')return window.mailWizard?.windowCommand('close');
  const message=current();if(!message){toast('Select a message first.');return;}
  if(command==='reply'||command==='forward')return openCompose(message,command);
  if(command==='star')return changeMessages([message],{starred:!message.starred});
  if(command==='read')return changeMessages(threadMembers(message),{read:!message.read});
  if(command==='archive'||command==='trash')return changeMessages(threadMembers(message),{folder:command},{undo:true,label:command==='trash'?'Moved to Trash.':'Archived.'});
}
$$('[data-command]').forEach(button=>button.onclick=()=>runCommand(button.dataset.command).catch(e=>toast(e.message)));
const menuDefinitions={
  file:()=>[['New Message','new','C'],['Get New Messages','refresh'],null,['Account Settings…','settings'],['Import & Export…','data'],null,['Print Message…','print','',!!current()],['Exit','close','',!!window.mailWizard]],
  edit:()=>[['Undo Last Action','undo','',!!toastAction],null,['Select All Messages','select-all'],['Find Messages…','find','/']],
  view:()=>[['Stacked Panes','stacked','',true,document.documentElement.dataset.layout!=='side'],['Side-by-Side Panes','side','',true,document.documentElement.dataset.layout==='side'],null,['All Messages','all','',true,!unreadOnly],['Unread Messages','unread','',true,unreadOnly],null,['Dark Theme','theme','',true,document.documentElement.dataset.theme==='dark']],
  go:()=>[['Inbox','go:inbox'],['Starred','go:starred'],['Drafts','go:drafts'],['Sent','go:sent'],['Archive','go:archive'],['Trash','go:trash']],
  message:()=>[['Reply','reply','',!!current()],['Forward','forward','',!!current()],null,['Star / Unstar','star','S',!!current()],['Read / Unread','read','',!!current()],['Archive','archive','E',!!current()],['Move to Trash','trash','',!!current()]],
  tools:()=>[['Address Book…','contacts'],['Account Settings…','settings'],['Preferences…','preferences'],['Local Storage & Backup…','data']],
  help:()=>[['Keyboard Shortcuts','shortcuts','?'],['About Mail Wizard','about']]
};
function closeMenu() {$('#application-menu').hidden=true;$$('[data-menu]').forEach(b=>b.setAttribute('aria-expanded','false'));}
function openMenu(button) {
  const menu=$('#application-menu'),same=button.getAttribute('aria-expanded')==='true';closeMenu();if(same)return;
  const definitions=menuDefinitions[button.dataset.menu]();
  menu.innerHTML=definitions.map(item=>item?`<button role="menuitem" data-menu-command="${item[1]}" ${item[3]===false?'disabled':''}>${item[4]?'<span class="menu-check">✓</span>':''}<span>${esc(item[0])}</span>${item[2]?`<kbd>${esc(item[2])}</kbd>`:''}</button>`:'<hr role="separator">').join('');
  const box=button.getBoundingClientRect();menu.style.left=Math.min(box.left,Math.max(4,innerWidth-250))+'px';menu.style.top=box.bottom+'px';menu.hidden=false;button.setAttribute('aria-expanded','true');
}
$('#menubar').onclick=e=>{const button=e.target.closest('[data-menu]');if(button)openMenu(button);};
$('#menubar').onkeydown=e=>{if(e.key==='ArrowDown'){e.preventDefault();const b=e.target.closest('[data-menu]');if(b&&b.getAttribute('aria-expanded')!=='true')openMenu(b);$('#application-menu button:not(:disabled)')?.focus();}};
$('#application-menu').onclick=e=>{const b=e.target.closest('[data-menu-command]');if(b){closeMenu();runCommand(b.dataset.menuCommand).catch(e=>toast(e.message));}};
$('#application-menu').onkeydown=e=>{
  const buttons=$$('#application-menu button:not(:disabled)'),index=buttons.indexOf(document.activeElement);
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();buttons[(index+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();}
  if(e.key==='Escape'){e.preventDefault();const button=$('[data-menu][aria-expanded=true]');closeMenu();button?.focus();}
};
document.addEventListener('pointerdown',e=>{if(!e.target.closest('#menubar,#application-menu'))closeMenu();});
function allContacts() {
  const byEmail=new Map();
  for(const m of state.messages)for(const a of [m.from,...(m.to||[]),...(m.cc||[])])if(a?.email&&a.email!==state.account.email&&a.email.includes('@'))byEmail.set(a.email.toLowerCase(),{name:a.name || a.email.split('@')[0],email:a.email});
  for(const a of state.contacts||[])byEmail.set(a.email.toLowerCase(),a);
  return [...byEmail.values()].sort((a,b)=>a.name.localeCompare(b.name));
}
function renderContacts() {
  const q=$('#contacts-search').value.toLowerCase(),contacts=allContacts().filter(a=>(a.name+' '+a.email).toLowerCase().includes(q));
  $('#contact-list').innerHTML=contacts.map(a=>`<button class="contact-row" data-contact="${esc(a.email)}" aria-label="Write to ${esc(a.name)}"><span>${esc(a.name)}</span><span>${esc(a.email)}</span></button>`).join('')||'<div class="empty-list">No contacts found.</div>';
}
function openContacts() {$('#contacts-search').value='';renderContacts();dialogOpen('#contacts-dialog');}
$('#address-book-button').onclick=openContacts;$('#contacts-search').oninput=renderContacts;
$('#contact-list').onclick=async e=>{const button=e.target.closest('[data-contact]');if(button){dialogClose('#contacts-dialog');await openCompose();$('#compose-to').value=button.dataset.contact;await saveDraft();}};
$('#add-contact').onclick=()=>promptValue('New Contact','Name and email address','For example: Ada Williams <ada@example.com>. Contacts are stored on this device.',async value=>{const parsed=addresses(value);if(parsed.length!==1)throw new Error('Enter one contact.');state.contacts=[...(state.contacts || []).filter(c=>c.email!==parsed[0].email),{name:parsed[0].name || parsed[0].email.split('@')[0],email:parsed[0].email}];await persist();renderContacts();});
if(window.mailWizard?.windowCommand){$('#window-controls').hidden=false;$$('[data-window]').forEach(b=>b.onclick=()=>window.mailWizard.windowCommand(b.dataset.window));}

async function boot() {
  hydrateIcons();applyTheme(document.documentElement.dataset.theme);
  try{
    const stored=ephemeralSample?null:await readStore();
    if(stored?.format==='mail-wizard-vault'){envelope=stored;dialogOpen('#unlock-dialog');}
    else {state=stored?validateSnapshot(stored):sampleState();activeId=state.messages.find(m=>m.id==='m2')?.id || state.messages[0]?.id || null;render();await persist();}
  }catch(e){toast('Mail Wizard could not open local storage: '+e.message,undefined,'',0);}
  if('serviceWorker' in navigator && location.protocol!=='file:' && !window.mailWizard)navigator.serviceWorker.register('./sw.js').then(r=>r.update()).catch(()=>{});
}
boot();
