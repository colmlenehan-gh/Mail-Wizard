const {app,BrowserWindow,ipcMain,protocol,net,session}=require('electron');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {MailService}=require('./mail-service.cjs');
protocol.registerSchemesAsPrivileged([{scheme:'wizard',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}}]);
let window, service;
const root=path.resolve(__dirname,'../dist');
const allowedFiles=new Set(['index.html','about.html','styles.css','app.js','about.js','manifest.webmanifest','mail-wizard-source.zip','icons/icon.svg','icons/icon-192.png','icons/icon-512.png','modules/core.js','modules/vault.js','modules/demo.js','modules/icons.js','modules/jmap.js','modules/desktop.js']);
function trusted(event) {return window && event.sender===window.webContents && event.senderFrame===window.webContents.mainFrame && event.senderFrame.url.startsWith('wizard://app/');}
async function createWindow() {
  window=new BrowserWindow({title:'Mail Wizard',width:1440,height:940,minWidth:420,minHeight:600,frame:false,icon:path.join(root,'icons/icon-192.png'),backgroundColor:'#d8e3ef',autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,allowRunningInsecureContent:false,devTools:!app.isPackaged}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith('wizard://app/'))event.preventDefault();});
  await window.loadURL('wizard://app/index.html');
}
app.whenReady().then(async()=>{
  service=new MailService();
  session.defaultSession.setPermissionRequestHandler((_web,_permission,callback)=>callback(false));
  session.defaultSession.setPermissionCheckHandler(()=>false);
  protocol.handle('wizard',request=>{
    const url=new URL(request.url);let file;
    try{file=decodeURIComponent(url.pathname).replace(/^\//,'') || 'index.html';}catch{return new Response('Bad request',{status:400});}
    if(url.host!=='app'||!allowedFiles.has(file))return new Response('Not found',{status:404});
    return net.fetch(pathToFileURL(path.join(root,file)).href);
  });
  for(const [name,method] of Object.entries({connect:'connect',sync:'sync',update:'update',send:'send',attachment:'attachment',disconnect:'disconnect'})){
    ipcMain.handle('mail:'+name,async(event,input)=>{if(!trusted(event))throw new Error('Untrusted mail request.');return service[method](input);});
  }
  ipcMain.handle('window:command',(event,command)=>{
    if(!trusted(event))throw new Error('Untrusted window request.');
    if(command==='minimize')window.minimize();
    else if(command==='maximize')window.isMaximized()?window.unmaximize():window.maximize();
    else if(command==='close')window.close();
    else throw new Error('Unsupported window command.');
  });
  await createWindow();
  app.on('activate',()=>{if(!BrowserWindow.getAllWindows().length)createWindow();});
});
app.on('window-all-closed',()=>{service?.disconnect();if(process.platform!=='darwin')app.quit();});
app.on('before-quit',()=>{service?.client?.close?.();});
