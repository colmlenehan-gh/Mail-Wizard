import {safeHTTPS, pointerEscape, htmlToText} from './core.js';
const CORE='urn:ietf:params:jmap:core', MAIL='urn:ietf:params:jmap:mail', SUB='urn:ietf:params:jmap:submission';
export class JMAPClient {
  constructor(sessionURL, token, fetcher = fetch) { this.sessionURL=safeHTTPS(sessionURL).href; this.token=token; this.fetcher=fetcher; this.boxes=[]; }
  async request(url, options={}) {
    safeHTTPS(url);
    let response;
    try { response=await this.fetcher(url,{...options,headers:{...options.headers,Authorization:'Bearer '+this.token},credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(45000)}); }
    catch { throw new Error('The mail provider could not be reached. Check the address, network and whether the provider permits browser connections (CORS).'); }
    if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'The provider rejected this token or its permissions.' : 'Mail provider returned HTTP '+response.status+'.');
    return response;
  }
  async connect() {
    this.session=await (await this.request(this.sessionURL)).json();
    if (!this.session.capabilities?.[MAIL]) throw new Error('This provider does not advertise JMAP Mail.');
    safeHTTPS(this.session.apiUrl);
    this.accountId=this.session.primaryAccounts?.[MAIL] || Object.keys(this.session.accounts || {}).find(k => this.session.accounts[k].accountCapabilities?.[MAIL]);
    if (!this.accountId) throw new Error('No mail account was returned by the provider.');
    const results=await this.call([['Mailbox/get',{accountId:this.accountId},'boxes'], ...(this.session.capabilities[SUB] ? [['Identity/get',{accountId:this.accountId},'identities']] : [])]);
    this.boxes=this.result(results,'boxes').list;
    this.identities=this.session.capabilities[SUB] ? this.result(results,'identities').list : [];
    return {boxes:this.boxes, identities:this.identities, name:this.session.accounts[this.accountId].name};
  }
  async call(methodCalls) {
    const using=[CORE,MAIL]; if (methodCalls.some(c => c[0].startsWith('Identity/') || c[0].startsWith('EmailSubmission/'))) using.push(SUB);
    const payload=await (await this.request(this.session.apiUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({using,methodCalls})})).json();
    if (!Array.isArray(payload.methodResponses)) throw new Error(payload.detail || 'Invalid JMAP response.');
    return payload.methodResponses;
  }
  result(results, tag) {
    const response=results.find(r => r[2]===tag);
    if (!response) throw new Error('The provider did not return '+tag+'.');
    if (response[0]==='error') throw new Error(response[1].description || response[1].type || 'JMAP method failed.');
    return response[1];
  }
  role(role) { return this.boxes.find(b => b.role===role)?.id; }
  async sync(position=0) {
    const results=await this.call([['Email/query',{accountId:this.accountId,sort:[{property:'receivedAt',isAscending:false}],position,limit:100,calculateTotal:true},'query'],['Email/get',{accountId:this.accountId,'#ids':{resultOf:'query',name:'Email/query',path:'/ids'},properties:['id','threadId','mailboxIds','keywords','from','to','cc','bcc','subject','receivedAt','preview','textBody','htmlBody','bodyValues','attachments','messageId','inReplyTo'],fetchTextBodyValues:true,fetchHTMLBodyValues:true,maxBodyValueBytes:200000},'messages']]);
    this.lastQuery=this.result(results,'query');
    const result=this.result(results,'messages');this.emailState=result.state;
    return result.list.map(m => this.normalize(m));
  }
  async reconcile(ids) {
    const messages=[],removed=[];
    for(let start=0;start<ids.length;start+=100) {
      const result=this.result(await this.call([['Email/get',{accountId:this.accountId,ids:ids.slice(start,start+100),properties:['id','threadId','mailboxIds','keywords','from','to','cc','subject','receivedAt','preview','textBody','htmlBody','bodyValues','attachments','messageId'],fetchTextBodyValues:true,fetchHTMLBodyValues:true,maxBodyValueBytes:200000},'known']]),'known');
      messages.push(...result.list.map(m=>this.normalize(m)));removed.push(...(result.notFound || []));
    }
    return {messages,removed};
  }
  normalize(m) {
    const roles=Object.keys(m.mailboxIds).map(id=>this.boxes.find(b=>b.id===id)?.role);
    const folder=roles.includes('trash')?'trash':roles.includes('junk')?'spam':roles.includes('drafts')?'drafts':roles.includes('inbox')?'inbox':roles.includes('sent')?'sent':'archive';
    const text=(m.textBody || []).map(p=>m.bodyValues?.[p.partId]?.value || '').join('\n');
    const html=(m.htmlBody || []).map(p=>m.bodyValues?.[p.partId]?.value || '').join('\n');
    const stripped=htmlToText(html);
    return {id:'jmap:'+m.id, remoteId:m.id, threadId:m.threadId, folder, from:m.from?.[0] || {name:'Unknown sender',email:''},to:m.to || [],cc:m.cc || [], subject:m.subject || '(No subject)',body:text || stripped || m.preview || '',date:m.receivedAt,read:!!m.keywords?.$seen,starred:!!m.keywords?.$flagged,labels:[],attachments:(m.attachments || []).map(a=>({...a,name:a.name || 'attachment',size:a.size || 0})),mailboxIds:m.mailboxIds,messageId:m.messageId,bodyTruncated: [...Object.values(m.bodyValues || {})].some(v=>v.isTruncated)};
  }
  async update(message, changes) {
    const patch={};
    if ('read' in changes) patch['keywords/$seen']=changes.read?true:null;
    if ('starred' in changes) patch['keywords/$flagged']=changes.starred?true:null;
    if (changes.folder) {
      const target=this.role(changes.folder==='spam'?'junk':changes.folder);
      if (!target) throw new Error('Your provider has no '+changes.folder+' mailbox.');
      const boxes={...message.mailboxIds};
      for (const b of this.boxes.filter(b=>['inbox','trash','junk','archive','drafts','sent'].includes(b.role))) delete boxes[b.id];
      boxes[target]=true; patch.mailboxIds=boxes;
    }
    if (!Object.keys(patch).length) return;
    const r=this.result(await this.call([['Email/set',{accountId:this.accountId,update:{[message.remoteId]:patch}},'update']]),'update');
    if (r.notUpdated?.[message.remoteId]) throw new Error(r.notUpdated[message.remoteId].description || 'The provider could not update this message.');
    if (patch.mailboxIds) message.mailboxIds=patch.mailboxIds;
  }
  async upload(file) {
    if (!this.session.uploadUrl) throw new Error('This provider does not support uploads.');
    const url=this.session.uploadUrl.replace('{accountId}',encodeURIComponent(this.accountId));
    return (await this.request(url,{method:'POST',headers:{'Content-Type':file.type || 'application/octet-stream'},body:file})).json();
  }
  async attachment(message, attachment) {
    if (!this.session.downloadUrl) throw new Error('Downloads are not supported by this provider.');
    const values={accountId:this.accountId,blobId:attachment.blobId,name:attachment.name || 'attachment',type:attachment.type || 'application/octet-stream'};
    const url=this.session.downloadUrl.replace(/\{(accountId|blobId|name|type)\}/g,(_,k)=>encodeURIComponent(values[k]));
    return (await this.request(url)).blob();
  }
  async send(draft) {
    if (!this.session.capabilities?.[SUB] || !this.identities?.length) throw new Error('This token does not allow sending, or no sending identity was found.');
    const identity=this.identities.find(i=>i.email===draft.from.email) || this.identities[0];
    const box=this.role('drafts'), sent=this.role('sent');
    if (!box || !sent) throw new Error('A drafts and sent mailbox are required for JMAP sending.');
    const attachments=[];
    for (const file of draft.files || []) { const up=await this.upload(file); attachments.push({blobId:up.blobId,type:file.type || 'application/octet-stream',name:file.name,disposition:'attachment'}); }
    const email={mailboxIds:{[box]:true},keywords:{$draft:true,$seen:true},from:[{name:identity.name,email:identity.email}],to:draft.to,cc:draft.cc,bcc:draft.bcc,subject:draft.subject,textBody:[{partId:'body',type:'text/plain'}],bodyValues:{body:{value:draft.body}}, ...(attachments.length?{attachments}:{}), ...(draft.replyMessageId?{inReplyTo:draft.replyMessageId}: {})};
    const result=this.result(await this.call([['Email/set',{accountId:this.accountId,create:{draft:email}},'create']]),'create');
    if (!result.created?.draft) throw new Error(result.notCreated?.draft?.description || 'The provider could not create the message.');
    const emailId=result.created.draft.id;
    let submissions;
    try { submissions=this.result(await this.call([['EmailSubmission/set',{accountId:this.accountId,create:{send:{emailId,identityId:identity.id,envelope:{mailFrom:{email:identity.email},rcptTo:[...draft.to,...draft.cc,...draft.bcc].map(a=>({email:a.email}))}}},onSuccessUpdateEmail:{'#send':{['mailboxIds/'+pointerEscape(box)]:null,['mailboxIds/'+pointerEscape(sent)]:true,'keywords/$draft':null}}},'send']]),'send'); }
    catch (e) { e.message+=' A draft was saved on your provider. Check Sent before retrying, to avoid duplicates.'; throw e; }
    if (!submissions.created?.send) throw new Error((submissions.notCreated?.send?.description || 'Sending failed.')+' Your draft remains on your provider.');
    return {id:'jmap:'+emailId,remoteId:emailId};
  }
}
