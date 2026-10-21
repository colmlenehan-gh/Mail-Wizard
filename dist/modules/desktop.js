export class DesktopClient {
  async connect(config) { this.info=await window.mailWizard.connect(config); return this.info; }
  async sync(folder='inbox',position=0) { const result=await window.mailWizard.sync({folder,position}); this.hasMore=result.hasMore; return result.messages; }
  async update(message,changes) {
    if(!Object.keys(changes).length)return;
    if(message.remoteStale)throw new Error('This moved message needs to be refreshed from its destination folder before another provider change.');
    const result=await window.mailWizard.update({id:message.remoteId,path:message.remotePath,changes});
    if(result.moved){
      if(result.refreshRequired)message.remoteStale=true;
      else {message.remoteId=result.remoteId;message.remotePath=result.remotePath;message.uidValidity=result.uidValidity;}
    }
    return result;
  }
  async send(draft) {
    const attachments=[];
    for (const file of draft.files || []) {
      const bytes=new Uint8Array(await file.arrayBuffer());
      const {encode64}=await import('./vault.js');
      attachments.push({name:file.name,type:file.type,data:encode64(bytes)});
    }
    return window.mailWizard.send({...draft,files:undefined,attachments});
  }
  async attachment(message,attachment) {
    const {decode64}=await import('./vault.js');
    const result=await window.mailWizard.attachment({id:message.remoteId,path:message.remotePath,index:attachment.index});
    return new Blob([decode64(result.data)],{type:result.type});
  }
}
