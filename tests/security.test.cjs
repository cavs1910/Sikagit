const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sikagit-security-'));
const root = path.join(tmp, 'repos'); fs.mkdirSync(root);
const repo = path.join(root, 'fixture'); fs.mkdirSync(repo);
const password = crypto.randomBytes(24).toString('hex');
const auth = path.join(tmp, 'auth.json');fs.writeFileSync(auth,JSON.stringify({username:'audit',password}));
const base = 'http://127.0.0.1:18880';
Object.assign(process.env,{PROJECTS_ROOT:root,AUTH_FILE:auth,PUBLIC_ORIGIN:base,PORT:'18880',DATA_DIR:path.join(tmp,'data')});
const git = (...args) => execFileSync('/usr/bin/git',['-C',repo,...args],{encoding:'utf8'}).trim();
git('init','-q');git('config','user.name','Audit');git('config','user.email','audit@example.invalid');
fs.writeFileSync(path.join(repo,'tracked.txt'),'original\n');git('add','.');git('commit','-qm','initial');
const sec = require('/app/server/dist/server/src/security.js');
const services = require('/app/server/dist/server/src/services/gitService.js');
const headers = {Authorization:'Basic '+Buffer.from('audit:'+password).toString('base64'),'Content-Type':'application/json'};
const fixtureFile=path.join(tmp,'ai-fixture.json'); process.env.AI_TEST_FIXTURE=fixtureFile; process.env.AI_TEST_CATALOG_LOG=path.join(tmp,'catalog-requests.jsonl');
const child = spawn(process.execPath,['--require','/tests/ai-provider-mock.cjs','/app/server/dist/server/src/index.js'],{env:process.env,stdio:['ignore','ignore','pipe']});
let logs='';child.stderr.on('data',d=>{logs+=d;});
const ready = (async()=>{for(let i=0;i<100;i++){try{const r=await fetch(base+'/api/v1/health',{headers});if(r.ok)return;}catch{}await new Promise(r=>setTimeout(r,50));}throw new Error('Server did not start: '+logs.slice(-1000));})();
async function request(route,body,extra={}){await ready;return fetch(base+route,{method:body===undefined?'GET':'POST',headers:{...headers,...extra},body:body===undefined?undefined:JSON.stringify(body)});}
after(async()=>{child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));fs.rmSync(tmp,{recursive:true,force:true});});

test('foreign browser origin and missing credentials are rejected',async()=>{
 await ready;assert.equal((await fetch(base+'/api/v1/repos')).status,401);
 assert.equal((await request('/api/v1/repos',undefined,{Origin:'https://foreign.invalid'})).status,403);
 assert.equal((await request('/api/v1/repos',undefined,{'Sec-Fetch-Site':'cross-site','Sec-Fetch-Mode':'cors'})).status,403);
 const status=await new Promise((resolve,reject)=>{require('node:http').get(base+'/api/v1/repos',{headers:{...headers,'Sec-Fetch-Site':'cross-site','Sec-Fetch-Mode':'navigate'}},r=>{r.resume();resolve(r.statusCode);}).on('error',reject);});
 assert.equal(status,200);
});
test('authenticated replies issue signed HttpOnly cookies; forgeries fail',async()=>{
 const r=await request('/api/v1/health');const cookie=r.headers.get('set-cookie');assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);
 assert.equal((await fetch(base+'/api/v1/repos',{headers:{Cookie:cookie.split(';')[0]}})).status,200);
 assert.equal((await fetch(base+'/api/v1/repos',{headers:{Cookie:'sikagit_session='+Date.now()+'.'+'a'.repeat(64)}})).status,401);
});
test('anonymous Socket.IO does not crash the service',async()=>{
 assert.equal((await fetch(base+'/socket.io/?EIO=4&transport=polling')).status,401);
 assert.equal((await request('/api/v1/health')).status,200);
});
test('authenticated Socket.IO accepts the signed session cookie',async()=>{
 const r=await request('/api/v1/health');const cookie=r.headers.get('set-cookie').split(';')[0];
 const s=await fetch(base+'/socket.io/?EIO=4&transport=polling',{headers:{Cookie:cookie,Origin:base}});assert.equal(s.status,200);assert.match(await s.text(),/^0\{/);
});
test('unconfigured AI and foreign remote/config commands are blocked',async()=>{
 assert.equal((await request('/api/v1/ai/suggest',{repo})).status,400);
 assert.equal((await request('/api/v1/git/config',{repo,key:'core.sshCommand',value:'touch /tmp/injected'})).ok,false);
 assert.equal((await request('/api/v1/git/remote-url',{repo,url:'ext::sh -c true'})).ok,false);
});
test('file boundaries reject traversal, absolute paths, options, metadata and control characters',()=>{
 for(const file of ['../auth.json','/etc/passwd','--help','.git/config','x\nfile','x\0file'])assert.throws(()=>sec.confinedFile(repo,file));
 assert.throws(()=>sec.confinedRepo(path.dirname(root)));
});
test('symlinks into Git metadata, other repositories and dangling targets are rejected',()=>{
 const other=path.join(root,'other');fs.mkdirSync(other);fs.writeFileSync(path.join(other,'secret'),'other repo');
 for(const [name,target] of [['meta','.git/config'],['outside',auth],['other',path.join(other,'secret')],['dangling',path.join(tmp,'absent')]]){
  fs.symlinkSync(target,path.join(repo,name));assert.throws(()=>sec.confinedFile(repo,name));
 }
 assert.throws(()=>sec.confinedRepo(path.join(repo,'.git')));
});
test('file preview rejects large files and nonregular files',async()=>{
 const large=path.join(repo,'large.bin');const fd=fs.openSync(large,'w');fs.ftruncateSync(fd,11*1024*1024);fs.closeSync(fd);
 await assert.rejects(services.getFileContent(repo,'large.bin'));
 await assert.rejects(services.getFileContent(repo,'.'));
});
test('revision and file inputs cannot inject commands',async()=>{
 for(const value of ['HEAD;touch /tmp/injected','--help','$(id)','a\n1234'])assert.throws(()=>sec.safeRevision(value));
 await assert.rejects(services.getCommitFiles(repo,'HEAD;touch /tmp/injected'));
 assert.equal(fs.existsSync('/tmp/injected'),false);
});
test('delete-untracked refuses tracked files and validates the whole batch',async()=>{
 fs.writeFileSync(path.join(repo,'delete-me'),'untracked');
 await assert.rejects(services.deleteUntrackedFiles(repo,['delete-me','tracked.txt']));
 assert.equal(fs.readFileSync(path.join(repo,'tracked.txt'),'utf8'),'original\n');assert.ok(fs.existsSync(path.join(repo,'delete-me')));
 await services.deleteUntrackedFiles(repo,['delete-me']);assert.equal(fs.existsSync(path.join(repo,'delete-me')),false);
});
test('stage and commit preserve literal shell metacharacters',async()=>{
 const file='literal;$(touch injected).txt';fs.writeFileSync(path.join(repo,file),'literal\n');
 await services.stageFiles(repo,[file]);const message="literal 'quoted'; $(touch /tmp/injected)";
 await services.commit(repo,message);assert.equal(git('log','-1','--format=%s'),message);assert.equal(fs.existsSync('/tmp/injected'),false);
});
test('history delimiters in commit messages do not forge additional records',async()=>{
 git('commit','--allow-empty','-qm','subject\n\n---END---\nmalicious-looking record\nmore lines');
 const actual=Number(git('rev-list','--count','--all'));const history=await services.getLogWithParents(repo,500,0);assert.equal(history.length,actual);
 assert.ok(history.every(c=>/^[0-9a-f]{40,64}$/.test(c.hash)));assert.match(history[0].body,/---END---/);
});
test('historical checkout preserves dirty work',async()=>{
 const branch=git('symbolic-ref','--short','HEAD');
 fs.writeFileSync(path.join(repo,'tracked.txt'),'do not lose\n');try { await services.checkoutCommit(repo,git('rev-parse','HEAD~2')); } catch {}
 assert.equal(fs.readFileSync(path.join(repo,'tracked.txt'),'utf8'),'do not lose\n');git('checkout','--','tracked.txt');git('checkout',branch);
});
test('save-for-later refuses a partial index without changing it',async()=>{
 fs.writeFileSync(path.join(repo,'tracked.txt'),'staged\n');git('add','tracked.txt');fs.writeFileSync(path.join(repo,'tracked.txt'),'staged plus unstaged\n');
 const before=git('diff','--cached');await assert.rejects(services.saveForLater(repo,['tracked.txt'],'shelf-test','shelf'));
 assert.equal(git('diff','--cached'),before);assert.equal(fs.readFileSync(path.join(repo,'tracked.txt'),'utf8'),'staged plus unstaged\n');git('reset','--hard','HEAD');
});
test('recent Git index locks cannot be removed by the API',async()=>{
 const lock=path.join(repo,'.git/index.lock');fs.writeFileSync(lock,'audit');
 const d=await fetch(base+'/api/v1/git/lock?repo='+encodeURIComponent(repo),{method:'DELETE',headers});assert.equal(d.ok,false);assert.ok(fs.existsSync(lock));fs.unlinkSync(lock);
});
test('repository-configured programs are blocked by the Git policy',()=>{
 for(const key of ['core.fsmonitor','credential.helper','diff.audit.textconv','merge.audit.driver','include.path','alias.audit','core.editor','http.sslVerify','url.audit.pushInsteadOf']){
  git('config',key,'echo unsafe');let result;
  try{execFileSync('/usr/local/bin/git',['status','--short'],{cwd:repo,stdio:'pipe'});result=true;}catch{result=false;}
  git('config','--unset',key);assert.equal(result,false,key);
 }
 assert.equal(fs.existsSync('/tmp/injected'),false);
});
test('credential helper sends only the active account token to HTTPS github.com',async()=>{
 const {credentialsFor}=await import('/usr/local/lib/sikagit-git-credential.mjs');
 const text='github.com:\n    users:\n        other:\n            oauth_token: nested_dummy\n    oauth_token: active_dummy\n    user: audit-user\n';
 assert.deepEqual(credentialsFor('protocol=https\nhost=github.com\n',text),{username:'audit-user',password:'active_dummy'});
 for(const input of ['protocol=http\nhost=github.com','protocol=https\nhost=foreign.invalid','protocol=https\nhost=github.com@foreign.invalid','protocol=https\nhost=github.com\nusername=other'])assert.equal(credentialsFor(input,text),null);
 assert.equal(credentialsFor('protocol=https\nhost=github.com','github.com:\n    user: audit-user\n'),null);
});

test('destructive JSON options require actual booleans',async()=>{
 for(const [route,body] of [['commit',{repo,message:'not committed',amend:'false'}],['push',{repo,force:'false'}],['branch/delete',{repo,branch:'master',force:'false'}]]){
  assert.equal((await request('/api/v1/git/'+route,body)).status,400);
 }
});
test('file response keeps an active SVG in a sandbox without script permissions',async()=>{
 fs.writeFileSync(path.join(repo,'active.svg'),'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
 const r=await request('/api/v1/git/file?repo='+encodeURIComponent(repo)+'&file=active.svg');
 assert.equal(r.status,200);assert.match(r.headers.get('content-security-policy'),/sandbox/);assert.match(r.headers.get('content-security-policy'),/default-src 'none'/);assert.equal(r.headers.get('x-content-type-options'),'nosniff');
});

async function aiSettings(change={}) {
 const prior=await (await request('/api/v1/ai/settings')).json();
 const response=await fetch(base+'/api/v1/ai/settings',{method:'PUT',headers,body:JSON.stringify({...prior.data,...change})});
 return {response,data:await response.json()};
}
function aiOutput(output,status) {fs.writeFileSync(fixtureFile,JSON.stringify({output,status,secret:'fake-private-marker'}));}
test('AI keys are encrypted, never returned, and cannot silently cross providers',async()=>{
 const key='fake-test-key-'+crypto.randomBytes(16).toString('hex');
 const {response,data}=await aiSettings({apiKey:key,provider:'openai',model:'test-model',enabled:true});
 assert.equal(response.status,200);assert.equal(data.data.hasApiKey,true);assert.equal(JSON.stringify(data).includes(key),false);
 const disk=fs.readFileSync(path.join(tmp,'data/ai-settings.json'),'utf8');assert.equal(disk.includes(key),false);
 assert.equal(fs.statSync(path.join(tmp,'data/ai-settings.key')).mode&0o777,0o600);
 assert.equal((await aiSettings({language:'en'})).data.data.hasApiKey,true);
 assert.equal((await aiSettings({provider:'anthropic'})).response.status,400);
 assert.equal((await aiSettings({provider:'openai',baseURL:'http://127.0.0.1/'})).data.data.baseURL,undefined);
});
test('AI SDK connection, messages, shelving and safe provider errors',async()=>{
 aiOutput({ok:true});assert.equal((await request('/api/v1/ai/test',{})).status,200);
 fs.writeFileSync(path.join(repo,'tracked.txt'),'AI staged\n');git('add','tracked.txt');
 aiOutput({title:'fix: preserve staged changes',description:'Keep exact index content.'});
 const message=await (await request('/api/v1/ai/suggest',{repo,apiKey:'ignored',model:'ignored'})).json();assert.equal(message.data.title,'fix: preserve staged changes');
 aiOutput({branchName:'save/staged-changes',message:'Save staged changes\n\nChanges: update tracked file. Context: deferred.'});
 assert.equal((await request('/api/v1/ai/suggest-save-for-later',{repo,files:['tracked.txt']})).status,200);
 assert.equal((await request('/api/v1/ai/suggest-save-for-later',{repo,files:['../auth.json']})).status,400);
 aiOutput({},401);const failure=await request('/api/v1/ai/test',{});const text=await failure.text();assert.equal(failure.status,400);assert.match(text,/API key/);assert.equal(text.includes('fake-private-marker'),false);
 git('reset','--hard','HEAD');
});
test('Smart Commit rejects stale, duplicate and invented paths and preserves partial staging',async()=>{
 fs.writeFileSync(path.join(repo,'tracked.txt'),'index only\n');git('add','tracked.txt');fs.writeFileSync(path.join(repo,'tracked.txt'),'index only plus unstaged\n');
 fs.writeFileSync(path.join(repo,'second.txt'),'second index\n');git('add','second.txt');
 const groups=[{files:['tracked.txt'],title:'fix: first group',description:''},{files:['second.txt'],title:'feat: second group',description:''}];
 aiOutput({groups});let preview=await (await request('/api/v1/ai/smart-commit/preview',{repo})).json();assert.ok(preview.data?.planId,JSON.stringify(preview));
 const start=git('rev-parse','HEAD');
 assert.equal((await request('/api/v1/ai/smart-commit/execute',{repo,planId:preview.data.planId,groups:[{...groups[0],files:['../auth.json']},groups[1]]})).status,400);
 assert.equal((await request('/api/v1/ai/smart-commit/execute',{repo,planId:preview.data.planId,groups:[groups[0],groups[0]]})).status,400);
 assert.equal(git('rev-parse','HEAD'),start);
 fs.writeFileSync(path.join(repo,'second.txt'),'changed index\n');git('add','second.txt');
 assert.equal((await request('/api/v1/ai/smart-commit/execute',{repo,planId:preview.data.planId,groups})).status,400);
 preview=await (await request('/api/v1/ai/smart-commit/preview',{repo})).json();
 const result=await (await request('/api/v1/ai/smart-commit/execute',{repo,planId:preview.data.planId,groups})).json();assert.equal(result.data?.commits.length,2,JSON.stringify(result));
 assert.equal(git('show','HEAD:tracked.txt'),'index only');assert.equal(fs.readFileSync(path.join(repo,'tracked.txt'),'utf8'),'index only plus unstaged\n');assert.equal(git('diff','--cached'),'');
 assert.equal((await request('/api/v1/ai/smart-commit/execute',{repo,planId:preview.data.planId,groups})).status,400);
 git('reset','--hard','HEAD');
});
test('JSON compatibility mode works through OpenRouter and removing a key disables generation',async()=>{
 assert.equal((await aiSettings({provider:'openrouter',apiKey:'fake-router-key',responseMode:'json'})).response.status,200);
 aiOutput({ok:true});assert.equal((await request('/api/v1/ai/test',{})).status,200);
 assert.equal((await aiSettings({enabled:false,removeKey:true})).data.data.hasApiKey,false);
 assert.equal((await request('/api/v1/ai/test',{})).status,400);
});
test('Smart Commit includes rename sources and deletions without leaving staged paths behind',async()=>{
 await aiSettings({provider:'openai',apiKey:'fake-openai-key',model:'test-model',enabled:true,responseMode:'structured'});
 git('mv','tracked.txt','renamed.txt');git('rm','second.txt');
 const groups=[{files:['tracked.txt','renamed.txt'],title:'refactor: rename tracked file',description:''},{files:['second.txt'],title:'chore: remove second file',description:''}];aiOutput({groups});
 const preview=await (await request('/api/v1/ai/smart-commit/preview',{repo})).json();assert.ok(preview.data?.planId,JSON.stringify(preview));
 const response=await (await request('/api/v1/ai/smart-commit/execute',{repo,groups,planId:preview.data.planId})).json();assert.equal(response.data?.commits.length,2,JSON.stringify(response));assert.equal(git('diff','--cached'),'');assert.equal(git('ls-files'),'literal;$(touch injected).txt\nrenamed.txt');
 await aiSettings({enabled:false,removeKey:true});
});
test('stale settings revisions cannot overwrite another device configuration',async()=>{
 const old=await (await request('/api/v1/ai/settings')).json();await aiSettings({language:'es'});
 const r=await fetch(base+'/api/v1/ai/settings',{method:'PUT',headers,body:JSON.stringify({...old.data,language:'auto'})});assert.equal(r.status,400);assert.match(await r.text(),/another device/);
});

test('AI grouping treats wildcard filenames as literal paths',async()=>{
 await aiSettings({provider:'openai',apiKey:'fake-openai-key',model:'test-model',enabled:true,responseMode:'structured'});
 const names=['special[1].txt','special1.txt'];for(const f of names)fs.writeFileSync(path.join(repo,f),'literal index\n');git('--literal-pathspecs','add','--',...names);
 const groups=names.map((f,i)=>({files:[f],title:'test: literal group '+i,description:''}));aiOutput({groups});
 const preview=await (await request('/api/v1/ai/smart-commit/preview',{repo})).json();
 const response=await (await request('/api/v1/ai/smart-commit/execute',{repo,groups,planId:preview.data.planId})).json();assert.equal(response.data?.commits.length,2,JSON.stringify(response));
 assert.equal(git('diff-tree','--no-commit-id','--name-only','-r','HEAD~1'),'special[1].txt');assert.equal(git('diff-tree','--no-commit-id','--name-only','-r','HEAD'),'special1.txt');
 await aiSettings({enabled:false,removeKey:true});
});

const editorUrl=(endpoint,file,extra={})=>base+'/api/v1/editor/'+endpoint+'?'+new URLSearchParams({repo,...(file===undefined?{}:{file}),...extra});
async function editorRead(file){await ready;return fetch(editorUrl('file',file),{headers});}
async function editorSave(file,content,revision){await ready;return fetch(base+'/api/v1/editor/file',{method:'PUT',headers,body:JSON.stringify({repo,file,content,revision})});}
test('editor explorer includes unchanged files, respects ignores and always hides Git metadata',async()=>{
 fs.writeFileSync(path.join(repo,'.gitignore'),'editor-ignored/\n');fs.mkdirSync(path.join(repo,'editor-ignored'));fs.writeFileSync(path.join(repo,'editor-ignored/hidden.txt'),'hidden');
 fs.mkdirSync(path.join(repo,'editor-directory'));fs.writeFileSync(path.join(repo,'editor-directory/unchanged.txt'),'unchanged');
 git('--literal-pathspecs','add','--','editor-directory/unchanged.txt');git('commit','-qm','editor fixture');
 let result=await (await fetch(editorUrl('tree',undefined),{headers})).json();assert.ok(result.data.some(e=>e.name==='editor-directory'&&e.type==='directory'));assert.equal(result.data.some(e=>e.name==='.git'||e.name==='editor-ignored'),false);
 result=await (await fetch(editorUrl('tree',undefined,{showIgnored:'true'}),{headers})).json();assert.equal(result.data.some(e=>e.name==='editor-ignored'),true);assert.equal(result.data.some(e=>e.name==='.git'),false);
 result=await (await fetch(editorUrl('tree',undefined,{directory:'editor-directory'}),{headers})).json();assert.equal(result.data[0].path,'editor-directory/unchanged.txt');
 assert.equal((await fetch(editorUrl('tree',undefined,{directory:'.git'}),{headers})).status,400);
});
test('editor saves exact UTF-8, BOM and CRLF content atomically without staging',async()=>{
 const file='editor-directory/utf8.txt';const original='\ufefflínea uno\r\n第二行\r\n';fs.writeFileSync(path.join(repo,file),original);fs.chmodSync(path.join(repo,file),0o640);
 const initial=await (await editorRead(file)).json();assert.equal(initial.data.content,original);assert.equal(initial.data.lineEnding,'crlf');assert.match(initial.data.revision,/^[a-f0-9]{64}$/);
 const cachedBefore=git('diff','--cached');const content=original+'otra línea\r\n';
 const response=await editorSave(file,content,initial.data.revision);const saved=await response.json();assert.equal(response.status,200,JSON.stringify(saved));assert.equal(fs.readFileSync(path.join(repo,file),'utf8'),content);assert.equal(saved.data.content,content);assert.notEqual(saved.data.revision,initial.data.revision);assert.equal(fs.statSync(path.join(repo,file)).mode&0o777,0o640);assert.equal(git('diff','--cached'),cachedBefore);
 const metadata=await (await fetch(editorUrl('file',file,{metadata:'true'}),{headers})).json();assert.equal(metadata.data.revision,saved.data.revision);assert.equal('content' in metadata.data,false);
 assert.equal(fs.readdirSync(path.join(repo,'editor-directory')).some(f=>f.startsWith('.sikagit-edit-')),false);
});
test('editor rejects stale and simultaneous saves without overwriting external changes',async()=>{
 const file='editor-directory/conflict.txt';fs.writeFileSync(path.join(repo,file),'initial\n');let initial=await (await editorRead(file)).json();fs.writeFileSync(path.join(repo,file),'external update\n');
 const rejected=await editorSave(file,'stale browser draft\n',initial.data.revision);assert.equal(rejected.status,409);assert.equal(fs.readFileSync(path.join(repo,file),'utf8'),'external update\n');
 initial=await (await editorRead(file)).json();const results=await Promise.all([editorSave(file,'first\n',initial.data.revision),editorSave(file,'second\n',initial.data.revision)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.ok(['first\n','second\n'].includes(fs.readFileSync(path.join(repo,file),'utf8')));
});
test('editor rejects metadata, traversal, symlinks, hard links, binaries and invalid encodings',async()=>{
 const dir=path.join(repo,'editor-directory');fs.writeFileSync(path.join(dir,'plain.txt'),'plain');fs.symlinkSync(path.join(dir,'plain.txt'),path.join(dir,'link.txt'));fs.symlinkSync(dir,path.join(repo,'editor-linked-directory'));fs.linkSync(path.join(dir,'plain.txt'),path.join(dir,'hardlink.txt'));
 fs.writeFileSync(path.join(dir,'binary.bin'),Buffer.from([0,1,2]));fs.writeFileSync(path.join(dir,'invalid.txt'),Buffer.from([0xff,0xfe]));fs.writeFileSync(path.join(dir,'mixed.txt'),'a\r\nb\nc');
 for(const file of ['../auth.json','/etc/passwd','.git/config','editor-directory/link.txt','editor-linked-directory/plain.txt','editor-directory/hardlink.txt','editor-directory/binary.bin','editor-directory/invalid.txt','editor-directory/mixed.txt','x\nfile','--help'])assert.equal((await editorRead(file)).status,400,file);
 const tree=await (await fetch(editorUrl('tree',undefined,{directory:'editor-directory'}),{headers})).json();assert.equal(tree.data.find(e=>e.name==='link.txt').type,'blocked');
 assert.equal((await fetch(editorUrl('tree',undefined,{directory:'editor-linked-directory'}),{headers})).status,400);
 const forbidden=await editorSave('.git/config','unsafe','a'.repeat(64));assert.equal(forbidden.status,400);
 fs.unlinkSync(path.join(dir,'hardlink.txt'));
});
test('editor bounds file sizes and refuses missing revisions, read-only files and special files',async()=>{
 const file='editor-directory/bounded.txt';fs.writeFileSync(path.join(repo,file),'small');const initial=await (await editorRead(file)).json();
 assert.equal((await editorSave(file,'a'.repeat(1024*1024+1),initial.data.revision)).status,413);assert.equal((await editorSave(file,'oops',undefined)).status,400);assert.equal((await editorSave(file,'\0',initial.data.revision)).status,400);
 fs.chmodSync(path.join(repo,file),0o444);const readOnly=await (await editorRead(file)).json();assert.equal((await editorSave(file,'overwrite',readOnly.data.revision)).status,400);assert.equal(fs.readFileSync(path.join(repo,file),'utf8'),'small');fs.chmodSync(path.join(repo,file),0o644);
 fs.writeFileSync(path.join(repo,'editor-directory/too-large.txt'),Buffer.alloc(1024*1024+1,65));assert.equal((await editorRead('editor-directory/too-large.txt')).status,413);
 execFileSync('mkfifo',[path.join(repo,'editor-directory/pipe')]);assert.equal((await editorRead('editor-directory/pipe')).status,400);
 assert.equal((await editorSave('editor-directory/new-file.txt','not created','a'.repeat(64))).status,400);assert.equal(fs.existsSync(path.join(repo,'editor-directory/new-file.txt')),false);
});

const modelFixture=(id,cost={input:1,output:4})=>({id,name:'Model '+id,modalities:{input:['text'],output:['text']},cost,limit:{context:128000},structured_output:true,release_date:'2026-01-01'});
test('catalog normalizes provider prices, excludes retired/non-text models, and keeps unknown distinct from free',()=>{
 const {normalizeModels,catalogProvider}=require('/app/server/dist/server/src/services/modelCatalog.js');
 const data={openai:{models:{paid:modelFixture('paid'),free:modelFixture('free',{input:0,output:0}),unknown:modelFixture('unknown',{}),negative:modelFixture('negative',{input:-1,output:NaN}),image:{...modelFixture('image'),modalities:{input:['text'],output:['image']}},retired:{...modelFixture('retired'),status:'deprecated'},bad:{...modelFixture('bad'),id:'x\nmalicious'}}}};
 const models=normalizeModels('openai',data);assert.deepEqual(models.map(m=>m.id).sort(),['free','negative','paid','unknown']);assert.equal(models.find(m=>m.id==='paid').inputPrice,1);assert.equal(models.find(m=>m.id==='free').inputPrice,0);assert.equal(models.find(m=>m.id==='unknown').inputPrice,null);assert.equal(models.find(m=>m.id==='negative').inputPrice,null);
 assert.throws(()=>catalogProvider('https://127.0.0.1'));assert.throws(()=>normalizeModels('google',{}));
 const router=normalizeModels('openrouter',{data:[{id:'lab/model',architecture:{input_modalities:['text'],output_modalities:['text']},pricing:{prompt:'0.00000015',completion:'0.0000006',input_cache_read:'0'},context_length:64000,supported_parameters:['structured_outputs'],endpoints:['/api/v1/chat/completions']}]})[0];assert.ok(Math.abs(router.inputPrice-.15)<1e-12);assert.ok(Math.abs(router.outputPrice-.6)<1e-12);assert.equal(router.cacheReadPrice,0);assert.equal(router.structuredOutput,true);
});
test('public catalog works without a key, rejects arbitrary providers, and falls back offline for all direct providers',async()=>{
 fs.writeFileSync(fixtureFile,JSON.stringify({catalogOffline:true}));
 for(const provider of ['openai','anthropic','google','groq','deepseek','mistral','xai']){
  const r=await request('/api/v1/ai/models?provider='+provider);const body=await r.json();assert.equal(r.status,200,JSON.stringify(body));assert.equal(body.data.provider,provider);assert.equal(body.data.sourceType,'snapshot');assert.ok(body.data.models.length>0);assert.match(body.data.warning,/catalog|prices/i);assert.ok(body.data.models.every(m=>m.inputPrice===null||m.inputPrice>=0));
 }
 assert.equal((await request('/api/v1/ai/models?provider=http%3A%2F%2F127.0.0.1')).status,400);
 assert.equal((await fetch(base+'/api/v1/ai/models?provider=openai')).status,401);
});
test('live OpenRouter catalog converts units, uses no saved key and caches repeated refresh requests',async()=>{
 fs.writeFileSync(fixtureFile,JSON.stringify({catalog:{data:[{id:'lab/paid',name:'Paid fixture',architecture:{input_modalities:['text'],output_modalities:['text']},pricing:{prompt:'0.000001',completion:'0.000004'},supported_parameters:['structured_outputs'],context_length:100000},{id:'lab/free',name:'Free fixture',architecture:{input_modalities:['text'],output_modalities:['text']},pricing:{prompt:'0',completion:'0'},supported_parameters:[]}]}}));
 const response=await (await request('/api/v1/ai/models?provider=openrouter')).json();assert.equal(response.data.sourceType,'live');assert.equal(response.data.models.find(m=>m.id==='lab/paid').inputPrice,1);assert.equal(response.data.models.find(m=>m.id==='lab/paid').outputPrice,4);assert.equal(response.data.models.find(m=>m.id==='lab/free').outputPrice,0);
 const count=fs.readFileSync(process.env.AI_TEST_CATALOG_LOG,'utf8').trim().split('\n').length;
 await request('/api/v1/ai/models?provider=openrouter&refresh=true');assert.equal(fs.readFileSync(process.env.AI_TEST_CATALOG_LOG,'utf8').trim().split('\n').length,count);
 const calls=fs.readFileSync(process.env.AI_TEST_CATALOG_LOG,'utf8').trim().split('\n').map(JSON.parse);assert.ok(calls.every(c=>c.hasAuthorization===false&&c.redirect==='error'&&c.userAgent==='Sikagit/1.0'));
 const disk=JSON.parse(fs.readFileSync(path.join(tmp,'data/ai-model-catalog.json'),'utf8'));assert.equal(disk.openrouter.models.length,2);
});
test('catalog refresh recovers from stale persisted data and retains cache when upstream fails',async()=>{
 const filename='/app/server/dist/server/src/services/modelCatalog.js';delete require.cache[require.resolve(filename)];const catalog=require(filename);const original=global.fetch;let calls=0;
 try {
  global.fetch=async()=>{calls++;return new Response(JSON.stringify({openai:{models:{fixture:modelFixture('fresh-model')}}}),{headers:{'content-type':'application/json'}});};
  const fresh=await catalog.getModelCatalog('openai',true);assert.equal(fresh.sourceType,'live');assert.equal(fresh.models[0].id,'fresh-model');await catalog.getModelCatalog('openai',true);assert.equal(calls,1);
  delete require.cache[require.resolve(filename)];const failed=require(filename);global.fetch=async()=>{throw new Error('upstream outage with fake secret marker');};
  const fallback=await failed.getModelCatalog('openai',true);assert.equal(fallback.sourceType,'cache');assert.equal(fallback.models[0].id,'fresh-model');assert.match(fallback.warning,/unavailable/i);assert.equal(JSON.stringify(fallback).includes('fake secret marker'),false);
 }finally{global.fetch=original;}
});
