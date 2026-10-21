const {ImapFlow}=require('imapflow');
const nodemailer=require('nodemailer');
const MailComposer=require('nodemailer/lib/mail-composer');
const {simpleParser}=require('mailparser');
const crypto=require('node:crypto');
const MAX_SOURCE=32*1024*1024;
function host(value) {
  if(typeof value!=='string' || value.length>253 || !/^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(value))throw new Error('Enter a valid mail server hostname.');
  return value;
}
function validateConfig(input) {
  if(!input || typeof input.email!=='string' || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(input.email))throw new Error('A valid email address is required.');
  if(typeof input.password!=='string'||!input.password||input.password.length>4096)throw new Error('A provider app password is required.');
  const imapPort=Number(input.imapPort),smtpPort=Number(input.smtpPort);
  if(!Number.isInteger(imapPort)||imapPort<1||imapPort>65535)throw new Error('Invalid IMAP TLS port.');
  if(![465,587].includes(smtpPort))throw new Error('SMTP must use TLS on 465 or mandatory STARTTLS on 587.');
  return {email:input.email,password:input.password,imapHost:host(input.imapHost),smtpHost:host(input.smtpHost),imapPort,smtpPort};
}
function recipientList(input) {
  if(!Array.isArray(input)||input.length>100)throw new Error('Invalid recipients.');
  return input.map(a=>{
    if(!a||typeof a.email!=='string'||! /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(a.email))throw new Error('Invalid recipient email.');
    return {name:String(a.name || '').slice(0,200).replace(/[\r\n]/g,''),address:a.email};
  });
}
class MailService {
  constructor(deps={}) {this.IMAP=deps.ImapFlow || ImapFlow;this.smtpFactory=deps.smtpFactory || nodemailer.createTransport;this.parser=deps.parser || simpleParser;this.queue=Promise.resolve();this.allowedPaths=new Set();this.messages=new Map();}
  serialize(fn) {const task=this.queue.catch(()=>{}).then(fn);this.queue=task;return task;}
  connect(input) {return this.serialize(async()=>{
    await this.disconnectNow();const c=validateConfig(input);
    const client=new this.IMAP({host:c.imapHost,port:c.imapPort,secure:true,auth:{user:c.email,pass:c.password},logger:false,tls:{rejectUnauthorized:true,minVersion:'TLSv1.2'},connectionTimeout:20000,greetingTimeout:15000,socketTimeout:60000,disableAutoIdle:true});
    client.on('error',()=>{});
    const transporter=this.smtpFactory({host:c.smtpHost,port:c.smtpPort,secure:c.smtpPort===465,requireTLS:true,auth:{user:c.email,pass:c.password},tls:{rejectUnauthorized:true,minVersion:'TLSv1.2'},connectionTimeout:20000,greetingTimeout:15000,socketTimeout:60000,logger:false,debug:false,disableFileAccess:true,disableUrlAccess:true});
    try {await client.connect();await transporter.verify();this.boxes=await client.list();}
    catch(e){try{await client.logout();}catch{}transporter.close?.();throw new Error('Mail provider connection failed. Check the hostname, app password and provider permissions.');}
    this.client=client;this.transporter=transporter;this.config=c;this.allowedPaths=new Set(this.boxes.map(b=>b.path));
    this.roles={inbox:this.boxes.find(b=>b.path.toUpperCase()==='INBOX')?.path || 'INBOX'};
    const uses={sent:'\\Sent',archive:'\\Archive',trash:'\\Trash',spam:'\\Junk',drafts:'\\Drafts'};
    for(const [role,special] of Object.entries(uses))this.roles[role]=this.boxes.find(b=>b.specialUse===special)?.path;
    return {name:c.email.split('@')[0],email:c.email,folders:Object.keys(this.roles).filter(k=>this.roles[k])};
  });}
  assertConnected() {if(!this.client?.usable)throw new Error('The IMAP connection is closed. Reconnect in Settings.');}
  assertMessage(path,uid) {
    if(!this.allowedPaths.has(path)||!Number.isSafeInteger(uid)||uid<1)throw new Error('Invalid mailbox or message identifier.');
    const known=this.messages.get(path+':'+uid);if(!known)throw new Error('Sync this message before changing it.');return known;
  }
  sync({folder='inbox',position=0}={}) {return this.serialize(async()=>{
    this.assertConnected();if(!['inbox','sent','archive','trash','spam','drafts'].includes(folder))throw new Error('Invalid folder.');
    if(!Number.isSafeInteger(position)||position<0)throw new Error('Invalid message offset.');
    const path=this.roles[folder];if(!path)return {messages:[],hasMore:false,unsupported:true};
    const lock=await this.client.getMailboxLock(path);
    try {
      const total=this.client.mailbox.exists,validity=String(this.client.mailbox.uidValidity);const end=total-position;
      if(end<1)return {messages:[],hasMore:false};
      const start=Math.max(1,end-99);
      const heads=await this.client.fetchAll(start+':'+end,{uid:true,size:true,envelope:true,flags:true,threadId:true});
      const messages=[];
      for(const header of heads.reverse()) {
        const id='imap:'+Buffer.from(path).toString('base64url')+':'+validity+':'+header.uid;
        let parsed,tooLarge=header.size>MAX_SOURCE;
        if(!tooLarge){const full=await this.client.fetchOne(header.uid,{source:true},{uid:true});if(full?.source)parsed=await this.parser(full.source,{skipHtmlToText:false,skipTextToHtml:true,maxHtmlLengthToParse:200000});}
        const address=a=>({name:a?.name || '',email:a?.address || ''});
        const from=address(parsed?.from?.value?.[0] || header.envelope?.from?.[0]);
        const key=path+':'+header.uid;this.messages.set(key,{validity,id});
        const messageId=parsed?.messageId || header.envelope?.messageId;
        messages.push({id,remoteId:header.uid,remotePath:path,uidValidity:validity,threadId:header.threadId?String(header.threadId):String(parsed?.references?.[0] || parsed?.inReplyTo || messageId || id),folder,from,to:(parsed?.to?.value || header.envelope?.to || []).map(address),cc:(parsed?.cc?.value || header.envelope?.cc || []).map(address),subject:parsed?.subject || header.envelope?.subject || '(No subject)',body:tooLarge?'This message exceeds the 32 MB download limit. Open it with your mail provider.':parsed?.text || 'This message contains no plain-text content.',date:new Date(parsed?.date || header.envelope?.date || Date.now()).toISOString(),read:header.flags.has('\\Seen'),starred:header.flags.has('\\Flagged'),labels:[],attachments:(parsed?.attachments || []).map((a,index)=>({index,name:a.filename || 'attachment',type:a.contentType,size:a.size})),messageId:messageId?[messageId]:undefined,bodyTruncated:tooLarge});
      }
      return {messages,hasMore:start>1};
    }finally{lock.release();}
  });}
  update({id,path,changes}) {return this.serialize(async()=>{
    this.assertConnected();const known=this.assertMessage(path,id);
    if(!changes || Object.keys(changes).some(k=>!['read','starred','folder'].includes(k)))throw new Error('Invalid mail operation.');
    for(const flag of ['read','starred'])if(flag in changes && typeof changes[flag]!=='boolean')throw new Error('Mail flags must be boolean.');
    const target=changes.folder?this.roles[changes.folder]:null;
    if(changes.folder&&!target)throw new Error('Your provider does not advertise a '+changes.folder+' folder.');
    const lock=await this.client.getMailboxLock(path);
    try {
      if(String(this.client.mailbox.uidValidity)!==known.validity)throw new Error('The mailbox changed on your provider. Refresh before changing messages.');
      if('read' in changes)await this.client[changes.read?'messageFlagsAdd':'messageFlagsRemove'](id,['\\Seen'],{uid:true});
      if('starred' in changes)await this.client[changes.starred?'messageFlagsAdd':'messageFlagsRemove'](id,['\\Flagged'],{uid:true});
      if(target&&target!==path) {
        const moved=await this.client.messageMove(id,target,{uid:true});
        // A moved message gets a new UID. Return it when UIDPLUS is available.
        const nextUID=moved?.uidMap?.get?.(id);
        this.messages.delete(path+':'+id);
        const validity=moved?.uidValidity?String(moved.uidValidity):null;
        if(nextUID&&validity)this.messages.set(target+':'+nextUID,{validity,id:known.id});
        return {moved:true,refreshRequired:!nextUID||!validity,remoteId:nextUID || null,remotePath:target,uidValidity:validity};
      }
      return {updated:true};
    }finally{lock.release();}
  });}
  attachment({id,path,index}) {return this.serialize(async()=>{
    this.assertConnected();const known=this.assertMessage(path,id);if(!Number.isSafeInteger(index)||index<0||index>1000)throw new Error('Invalid attachment.');
    const lock=await this.client.getMailboxLock(path);
    try {
      if(String(this.client.mailbox.uidValidity)!==known.validity)throw new Error('Mailbox changed. Refresh before downloading.');
      const header=await this.client.fetchOne(id,{size:true},{uid:true});if(!header||header.size>MAX_SOURCE)throw new Error('Attachment message exceeds the 32 MB download limit.');
      const full=await this.client.fetchOne(id,{source:true},{uid:true});const parsed=await this.parser(full.source,{skipTextToHtml:true});const attachment=parsed.attachments[index];
      if(!attachment)throw new Error('Attachment is no longer available.');
      return {data:attachment.content.toString('base64'),type:attachment.contentType,name:attachment.filename};
    }finally{lock.release();}
  });}
  send(draft) {return this.serialize(async()=>{
    this.assertConnected();const to=recipientList(draft.to),cc=recipientList(draft.cc || []),bcc=recipientList(draft.bcc || []);
    if(!to.length||to.length+cc.length+bcc.length>100)throw new Error('Use between 1 and 100 recipients.');
    if(typeof draft.subject!=='string'||/[\r\n]/.test(draft.subject)||draft.subject.length>998)throw new Error('Invalid subject.');
    if(typeof draft.body!=='string'||draft.body.length>2000000)throw new Error('Message body exceeds 2 MB.');
    if(!Array.isArray(draft.attachments || [])||(draft.attachments || []).length>20)throw new Error('Too many attachments.');
    let total=0;
    const attachments=(draft.attachments || []).map(a=>{
      if(typeof a.data!=='string'||a.data.length>36*1024*1024||!/^[a-zA-Z0-9+/]*={0,2}$/.test(a.data))throw new Error('Invalid attachment data.');
      const content=Buffer.from(a.data,'base64');total+=content.length;if(total>25*1024*1024)throw new Error('Attachments exceed 25 MB.');
      return {filename:String(a.name || 'attachment').replace(/[\r\n/\\]/g,'_').slice(0,180),content,contentType:String(a.type || 'application/octet-stream').replace(/[\r\n]/g,'')};
    });
    const from=this.config.email,messageId='<'+crypto.randomUUID()+'@'+from.split('@')[1]+'>';
    const options={from,to,cc,bcc,subject:draft.subject,text:draft.body,attachments,messageId,disableFileAccess:true,disableUrlAccess:true,...(Array.isArray(draft.replyMessageId)?{inReplyTo:draft.replyMessageId[0]}:{})};
    const raw=await new MailComposer({...options,keepBcc:false}).compile().build();
    let result;
    try{result=await this.transporter.sendMail({envelope:{from,to:[...to,...cc,...bcc].map(a=>a.address)},raw,disableFileAccess:true,disableUrlAccess:true});}
    catch {throw new Error('SMTP did not confirm acceptance. Check your provider Sent folder before retrying.');}
    if(!result.accepted?.length)throw new Error('The provider did not accept any recipients.');
    const warnings=[];
    if(result.rejected?.length)warnings.push('Some recipients were rejected: '+result.rejected.join(', ')+'. Do not resend to recipients already accepted.');
    // Gmail automatically saves submitted mail; do not append a duplicate.
    const isGmail=/(^|\.)gmail\.com$/.test(this.config.smtpHost);
    if(!isGmail && this.roles.sent){try{await this.client.append(this.roles.sent,raw,['\\Seen'],new Date());}catch{warnings.push('SMTP accepted the message, but a Sent copy could not be saved.');}}
    else if(!isGmail&&!this.roles.sent)warnings.push('SMTP accepted the message; no Sent folder was advertised.');
    return {messageId,warning:warnings.join(' ')};
  });}
  async disconnectNow() {const c=this.client;this.client=null;this.transporter?.close?.();this.transporter=null;this.config=null;this.messages.clear();this.allowedPaths.clear();if(c)try{await c.logout();}catch{c.close?.();}}
  disconnect(){return this.serialize(()=>this.disconnectNow());}
}
module.exports={MailService,validateConfig,recipientList};
