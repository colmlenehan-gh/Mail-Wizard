import {readdir,readFile} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
const root=resolve(import.meta.dirname,'..');
async function walk(dir){const out=[];for(const ent of await readdir(dir,{withFileTypes:true})){if(['node_modules','.git','release'].includes(ent.name))continue;const p=join(dir,ent.name);if(ent.isDirectory())out.push(...await walk(p));else out.push(p);}return out;}
let count=0,errors=[];
for(const file of await walk(root)){
  if(/\.(mjs|cjs|js)$/.test(file)){const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});if(result.status)errors.push(file+'\n'+result.stderr);count++;}
  if(file.endsWith('.html')){const html=await readFile(file,'utf8');for(const m of html.matchAll(/(?:src|href)="(\.\/[^"]+)"/g)){const ref=m[1].split(/[?#]/)[0];if(ref==='./mail-wizard-source.zip')continue;try{await readFile(resolve(dirname(file),ref));}catch{errors.push('Missing reference: '+file+' -> '+ref);}}}
}
JSON.parse(await readFile(join(root,'dist/manifest.webmanifest'),'utf8'));
if(errors.length){console.error(errors.join('\n'));process.exitCode=1;}else console.log('Syntax verified for '+count+' JavaScript files; HTML references and PWA manifest verified.');
