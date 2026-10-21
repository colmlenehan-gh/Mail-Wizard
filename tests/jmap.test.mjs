import test from 'node:test';
import assert from 'node:assert/strict';
import {JMAPClient} from '../dist/modules/jmap.js';
const CORE='urn:ietf:params:jmap:core',MAIL='urn:ietf:params:jmap:mail',SUB='urn:ietf:params:jmap:submission';
const response=data=>new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
function fixture({rejectSubmission=false,readOnly=false,networkFail=false,notUpdated=false}={}) {
  const requests=[];
  const fetcher=async(url,options)=>{
    requests.push({url,options});assert.equal(options.headers.Authorization,'Bearer fixture-token');assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');
    if(networkFail)throw new Error('offline');
    if(url.endsWith('/session'))return response({capabilities:{[CORE]:{},[MAIL]:{},...(!readOnly?{[SUB]:{}}:{})},primaryAccounts:{[MAIL]:'a'},accounts:{a:{name:'Fixture',accountCapabilities:{[MAIL]:{}}}},apiUrl:'https://mail.example/api',uploadUrl:'https://mail.example/upload/{accountId}',downloadUrl:'https://mail.example/download/{accountId}/{blobId}/{name}?type={type}'});
    if(url.includes('/upload/'))return response({blobId:'blob',size:3});
    if(url.includes('/download/'))return new Response('attachment');
    const body=JSON.parse(options.body);
    const methodResponses=body.methodCalls.map(([name,args,tag])=>{
      if(name==='Mailbox/get')return [name,{list:[{id:'in',role:'inbox'},{id:'dr/a~ft',role:'drafts'},{id:'sent',role:'sent'},{id:'arc',role:'archive'}]},tag];
      if(name==='Identity/get')return [name,{list:[{id:'identity',email:'me@example.com',name:'Me'}]},tag];
      if(name==='Email/query')return [name,{ids:['e'],total:1,position:args.position},tag];
      if(name==='Email/get')return [name,{list:[{id:'e',threadId:'t',mailboxIds:{in:true},keywords:{$flagged:true},from:[{email:'sender@example.com'}],to:[{email:'me@example.com'}],subject:'Fixture',receivedAt:'2026-10-21T12:00:00Z',textBody:[{partId:'p'}],bodyValues:{p:{value:'Safe body'}},attachments:[]}],notFound:tag==='known'?args.ids.filter(id=>id!=='e'):[]},tag];
      if(name==='Email/set'&&args.create)return [name,{created:{draft:{id:'new'}}},tag];
      if(name==='Email/set')return [name,notUpdated?{notUpdated:{e:{description:'Read only mailbox'}}}:{updated:{e:null}},tag];
      if(name==='EmailSubmission/set')return [name,rejectSubmission?{notCreated:{send:{description:'Sending denied'}}}:{created:{send:{id:'submission'}}},tag];
      throw new Error('Unexpected method '+name);
    });return response({methodResponses});
  };
  return {client:new JMAPClient('https://mail.example/session','fixture-token',fetcher),requests};
}
test('JMAP discovers account, fetches a page, and normalizes mail',async()=>{const {client,requests}=fixture();await client.connect();const [m]=await client.sync(100);assert.equal(m.body,'Safe body');assert.equal(m.folder,'inbox');assert(m.starred);const query=JSON.parse(requests.at(-1).options.body).methodCalls[0];assert.equal(query[1].position,100);});
test('JMAP mailbox updates preserve unrelated mailboxes',async()=>{const {client,requests}=fixture();await client.connect();const m={remoteId:'e',mailboxIds:{in:true,custom:true}};await client.update(m,{folder:'archive',read:true});const patch=JSON.parse(requests.at(-1).options.body).methodCalls[0][1].update.e;assert.deepEqual(patch.mailboxIds,{custom:true,arc:true});assert.equal(patch['keywords/$seen'],true);});
test('JMAP sending creates a MIME model then submits with escaped mailbox paths',async()=>{const {client,requests}=fixture();await client.connect();const result=await client.send({from:{email:'me@example.com'},to:[{email:'to@example.com'}],cc:[],bcc:[{email:'hidden@example.com'}],subject:'Hello',body:'Message',files:[new File(['abc'],'a.txt',{type:'text/plain'})]});assert.equal(result.remoteId,'new');const call=JSON.parse(requests.at(-1).options.body).methodCalls[0];assert.equal(call[0],'EmailSubmission/set');assert.equal(call[1].onSuccessUpdateEmail['#send']['mailboxIds/dr~1a~0ft'],null);assert.equal(call[1].create.send.envelope.rcptTo.length,2);assert(requests.some(r=>r.url.includes('/upload/')));});
test('JMAP denied sending does not report success or destroy the provider draft',async()=>{const {client,requests}=fixture({rejectSubmission:true});await client.connect();await assert.rejects(client.send({from:{email:'me@example.com'},to:[{email:'to@example.com'}],cc:[],bcc:[],subject:'x',body:'x'}),/draft remains/);assert(!requests.some(r=>r.options.body?.includes('"destroy"')));});
test('JMAP read-only sessions cannot send and failed flag updates throw',async()=>{let f=fixture({readOnly:true});await f.client.connect();await assert.rejects(f.client.send({}),/does not allow sending/);f=fixture({notUpdated:true});await f.client.connect();await assert.rejects(f.client.update({remoteId:'e'},{read:true}),/Read only/);});
test('JMAP network errors do not leak tokens',async()=>{const {client}=fixture({networkFail:true});await assert.rejects(client.connect(),e=>e.message.includes('could not be reached')&&!e.message.includes('fixture-token'));});
test('JMAP reconciliation only removes messages authoritatively reported missing',async()=>{const {client}=fixture();await client.connect();const result=await client.reconcile(['e','missing']);assert.deepEqual(result.removed,['missing']);assert.equal(result.messages[0].remoteId,'e');});
