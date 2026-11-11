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
const fixtureFile=path.join(tmp,'ai-fixture.json'); process.env.AI_TEST_FIXTURE=fixtureFile; process.env.AI_TEST_CATALOG_LOG=path.join(tmp,'catalog-requests.jsonl'); process.env.AI_TEST_GATEWAY_LOG=path.join(tmp,'gateway-requests.jsonl');
process.env.SIKAGIT_TEST_REMOTE_FIXTURE=path.join(tmp,'git-remote-fixture.json');
const child = spawn(process.execPath,['--require','/tests/git-network-mock.cjs','--require','/tests/ai-provider-mock.cjs','/app/server/dist/server/src/index.js'],{env:process.env,stdio:['ignore','ignore','pipe']});
let logs='';child.stderr.on('data',d=>{logs+=d;});
const ready = (async()=>{for(let i=0;i<100;i++){try{const r=await fetch(base+'/api/v1/health',{headers});if(r.ok)return;}catch{}await new Promise(r=>setTimeout(r,50));}throw new Error('Server did not start: '+logs.slice(-1000));})();
async function request(route,body,extra={}){await ready;return fetch(base+route,{method:body===undefined?'GET':'POST',headers:{...headers,...extra},body:body===undefined?undefined:JSON.stringify(body)});}
after(async()=>{child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));fs.rmSync(tmp,{recursive:true,force:true});});

test('foreign browser origin and missing credentials are rejected',async()=>{
 await ready;assert.equal((await fetch(base+'/api/v1/repos')).status,401);
 assert.equal((await request('/api/v1/repos',undefined,{Origin:'https://foreign.invalid'})).status,403);
 assert.equal((await request('/api/v1/repos',undefined,{'Sec-Fetch-Site':'cross-site','Sec-Fetch-Mode':'cors'})).status,403);
 const status=await new Promise((resolve,reject)=>{require('node:http').get(base+'/',{headers:{...headers,'Sec-Fetch-Site':'cross-site','Sec-Fetch-Mode':'navigate'}},r=>{r.resume();resolve(r.statusCode);}).on('error',reject);});
 assert.equal(status,200);
});
test('authenticated replies issue signed HttpOnly cookies; forgeries fail',async()=>{
 const {response:r}=await signIn();const cookie=r.headers.get('set-cookie');assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);
 assert.equal((await fetch(base+'/api/v1/repos',{headers:{Cookie:cookie.split(';')[0]}})).status,200);
 assert.equal((await fetch(base+'/api/v1/repos',{headers:{Cookie:'sikagit_session='+Date.now()+'.'+'a'.repeat(64)}})).status,401);
});
test('anonymous Socket.IO does not crash the service',async()=>{
 assert.equal((await fetch(base+'/socket.io/?EIO=4&transport=polling')).status,401);
 assert.equal((await request('/api/v1/health')).status,200);
});
test('authenticated Socket.IO accepts the signed session cookie',async()=>{
 const {cookie}=await signIn();
 const s=await fetch(base+'/socket.io/?EIO=4&transport=polling',{headers:{Cookie:cookie,Origin:base}});assert.equal(s.status,200);assert.match(await s.text(),/^0\{/);
});

async function signIn(extra={}) {
 await ready;
 const response=await fetch(base+'/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:base,...extra},body:JSON.stringify({username:'audit',password})});
 assert.equal(response.status,200);
 return {cookie:response.headers.getSetCookie()[0].split(';')[0],response,data:(await response.json()).data};
}
test('anonymous web app shell and assets load without a Basic challenge; private data remains protected',async()=>{
 await ready;
 const page=await fetch(base+'/r/fixture');assert.equal(page.status,200);assert.equal(page.headers.get('www-authenticate'),null);assert.match(page.headers.get('content-security-policy'),/script-src 'self'/);
 const html=await page.text();const bundle=html.match(/src="([^\"]+\.js)"/)[1];assert.equal((await fetch(base+bundle)).status,200);
 const manifest=await (await fetch(base+'/manifest.webmanifest')).json();assert.equal(manifest.display,'standalone');
 const response=await fetch(base+'/api/v1/auth/session');assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('set-cookie'),null);
 assert.deepEqual((await response.json()).data,{authenticated:false,expiresAt:null});
 const privateResponse=await fetch(base+'/api/v1/repos');assert.equal(privateResponse.status,401);assert.equal(privateResponse.headers.get('www-authenticate'),null);assert.equal((await privateResponse.json()).success,false);
 const db=require('/app/server/dist/server/src/services/db.js').db,count=()=>db.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n;
 const sessions=count();for(let i=0;i<3;i++){const probe=await request('/api/v1/health');assert.equal(probe.status,200);assert.equal(probe.headers.get('set-cookie'),null);}assert.equal(count(),sessions);
});
test('form login uses a one-year opaque cookie, stores only a hash, and never slides the expiry',async()=>{
 const before=Date.now(),{cookie,response,data}=await signIn();
 const value=response.headers.getSetCookie()[0];assert.match(value,/HttpOnly/);assert.match(value,/SameSite=Strict/);
 const expires=Date.parse(value.match(/Expires=([^;]+)/i)[1]);assert.ok(Math.abs(expires-before-365*86400000)<3000);
 assert.ok(Math.abs(data.expiresAt-before-365*86400000)<3000);
 const repeated=await fetch(base+'/api/v1/auth/session',{headers:{Cookie:cookie}});assert.equal(repeated.headers.get('set-cookie'),null);assert.equal((await repeated.json()).data.expiresAt,data.expiresAt);
 const token=decodeURIComponent(cookie.split('=')[1]).slice(2).split('.')[0];assert.match(token,/^[0-9a-f]{64}$/);
 const db=require('/app/server/dist/server/src/services/db.js').db;
 const row=db.prepare('SELECT * FROM auth_sessions WHERE id_hash = ?').get(crypto.createHash('sha256').update(token).digest('hex'));
 assert.ok(row);assert.equal(JSON.stringify(row).includes(token),false);assert.equal(row.expires_at,data.expiresAt);
 const forged=cookie.slice(0,-1)+(cookie.endsWith('a')?'b':'a');assert.equal((await fetch(base+'/api/v1/repos',{headers:{Cookie:forged}})).status,401);
 db.prepare('UPDATE auth_sessions SET expires_at = ? WHERE id_hash = ?').run(Date.now()-1,row.id_hash);
 assert.equal((await fetch(base+'/api/v1/repos',{headers:{Cookie:cookie}})).status,401);
});
test('login and logout enforce Origin and JSON, reject bad credentials, and revoke only this device',async()=>{
 const malformed=await fetch(base+'/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:'{"password":"'+password+'",'});assert.equal(malformed.status,400);assert.equal((await malformed.text()).includes(password),false);assert.equal(logs.includes(password),false);
 const bad=await fetch(base+'/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({username:'audit',password:'wrong'})});assert.equal(bad.status,401);assert.equal(bad.headers.get('set-cookie'),null);
 assert.equal((await fetch(base+'/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'username=audit'})).status,415);
 const first=await signIn(),second=await signIn();assert.notEqual(first.cookie,second.cookie);
 for(const route of ['login','logout'])assert.equal((await fetch(base+'/api/v1/auth/'+route,{method:'POST',headers:{Cookie:first.cookie,Origin:'https://foreign.invalid','Content-Type':'application/json'},body:'{}'})).status,403);
 const logout=await fetch(base+'/api/v1/auth/logout',{method:'POST',headers:{Cookie:first.cookie,Origin:base,'Content-Type':'application/json'},body:'{}'});assert.equal(logout.status,200);assert.match(logout.headers.getSetCookie()[0],/Expires=Thu, 01 Jan 1970/);
 assert.equal((await fetch(base+'/api/v1/repos',{headers:{Cookie:first.cookie}})).status,401);
 assert.equal((await fetch(base+'/api/v1/repos',{headers:{Cookie:second.cookie}})).status,200);
 assert.equal((await (await request('/api/v1/auth/session')).json()).data.authenticated,false);
 assert.equal((await request('/api/v1/repos',undefined,{'Sec-Fetch-Site':'same-origin'})).status,401);
});
test('logout disconnects an already authenticated Socket.IO connection and rejects its cookie on reconnect',async()=>{
 const {io}=require('/app/node_modules/socket.io-client'),{cookie}=await signIn();
 const socket=io(base,{transports:['websocket'],extraHeaders:{Cookie:cookie,Origin:base},reconnection:false});
 try {
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Socket did not authenticate')),3000);socket.once('connect',()=>{clearTimeout(timer);resolve();});socket.once('connect_error',reject);});
  const disconnected=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Socket not revoked')),3000);socket.once('disconnect',()=>{clearTimeout(timer);resolve();});});
  const response=await fetch(base+'/api/v1/auth/logout',{method:'POST',headers:{Cookie:cookie,Origin:base,'Content-Type':'application/json'},body:'{}'});assert.equal(response.status,200);await disconnected;
  assert.equal((await fetch(base+'/socket.io/?EIO=4&transport=polling',{headers:{Cookie:cookie,Origin:base}})).status,401);
 }finally{socket.disconnect();}
});
test('sessions survive a server restart, require Secure under HTTPS, and fail after credentials rotate',async()=>{
 const port='18881',origin='https://auth-fixture.invalid';
 let peer;
 async function start(file=auth) {
  peer=spawn(process.execPath,['/app/server/dist/server/src/index.js'],{env:{...process.env,PORT:port,PUBLIC_ORIGIN:origin,AUTH_FILE:file},stdio:'ignore'});
  for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:'+port+'/api/v1/auth/session')).ok)return;}catch{}await new Promise(r=>setTimeout(r,50));}throw Error('Peer did not start');
 }
 async function stop(){if(peer.exitCode!==null||peer.signalCode!==null)return;const ended=new Promise(r=>peer.once('exit',r));peer.kill('SIGTERM');await ended;}
 try {
  await start();const login=await fetch('http://127.0.0.1:'+port+'/api/v1/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Forwarded-Proto':'https'},body:JSON.stringify({username:'audit',password})});assert.equal(login.status,200);
  const setCookie=login.headers.getSetCookie()[0];assert.match(setCookie,/; Secure/);const cookie=setCookie.split(';')[0];
  await stop();await start();
  const session=await fetch('http://127.0.0.1:'+port+'/api/v1/auth/session',{headers:{Cookie:cookie}});assert.equal((await session.json()).data.authenticated,true);
  await stop();const rotated=path.join(tmp,'rotated-auth.json');fs.writeFileSync(rotated,JSON.stringify({username:'audit',password:crypto.randomBytes(24).toString('hex')}));await start(rotated);
  assert.equal((await fetch('http://127.0.0.1:'+port+'/api/v1/repos',{headers:{Cookie:cookie}})).status,401);
 }finally{if(peer?.exitCode===null)await stop();}
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
 const old=await (await request('/api/v1/ai/settings')).json();await aiSettings({language:'auto'});
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

test('AI language defaults to project language and migrates legacy Spanish without changing keys',async()=>{
 const settings=require('/app/server/dist/server/src/services/aiSettings.js');const filename=path.join(tmp,'data/ai-settings.json');const previous=fs.readFileSync(filename,'utf8');
 try {
  fs.unlinkSync(filename);assert.equal(settings.publicSettings().language,'auto');
  settings.saveSettings({...settings.publicSettings(),apiKey:'fake-migration-key',enabled:false});
  const legacy={...JSON.parse(fs.readFileSync(filename,'utf8')),language:'es'};fs.writeFileSync(filename,JSON.stringify(legacy));
  assert.equal(settings.publicSettings().language,'auto');assert.equal(JSON.parse(fs.readFileSync(filename,'utf8')).secret,legacy.secret);
  const response=await aiSettings({language:'auto'});assert.equal(response.response.status,200);assert.equal(JSON.parse(fs.readFileSync(filename,'utf8')).language,'auto');assert.equal(JSON.parse(fs.readFileSync(filename,'utf8')).secret,legacy.secret);
  assert.equal((await aiSettings({language:'es'})).response.status,400);
  assert.equal((await aiSettings({language:'en'})).data.data.language,'en');
 }finally{fs.writeFileSync(filename,previous);}
});


test('Gateway managed and BYOK requests use saved, separately encrypted credentials and preserve direct connections',async()=>{
 const key='fake-gateway-key',byok='fake-provider-byok-key',direct='fake-direct-retained';
 await aiSettings({provider:'openai',model:'direct-model',apiKey:direct,enabled:true});
 let saved=await aiSettings({provider:'vercel',model:'openai/test-model',apiKey:key,gatewayMode:'managed',enabled:true});
 assert.equal(saved.response.status,200);assert.equal(saved.data.data.connections.openai.hasApiKey,true);
 aiOutput({ok:true});assert.equal((await request('/api/v1/ai/test',{apiKey:'request-body-must-not-win',byokApiKey:'ignored'})).status,200);
 const calls=()=>fs.readFileSync(process.env.AI_TEST_GATEWAY_LOG,'utf8').trim().split('\n').map(JSON.parse);
 let call=calls().at(-1);assert.equal(call.headers.authorization,'Bearer '+key);assert.equal(call.redirect,'error');assert.equal(call.headers['ai-language-model-id'],'openai/test-model');assert.equal(call.body.providerOptions?.gateway,undefined);
 saved=await aiSettings({gatewayMode:'byok',byokProvider:'openai',byokApiKey:byok});assert.equal(saved.response.status,200);assert.equal(saved.data.data.hasByokKey,true);
 assert.equal((await request('/api/v1/ai/test',{})).status,200);
 call=calls().at(-1);assert.deepEqual(call.body.providerOptions.gateway,{only:['openai'],byok:{openai:[{apiKey:byok}]}});
 assert.equal(call.headers.authorization,'Bearer '+key);
 await aiSettings({responseMode:'json'});fs.writeFileSync(fixtureFile,JSON.stringify({output:{ok:true},warnings:[{type:'other',message:'fake-private-warning-key'}]}));assert.equal((await request('/api/v1/ai/test',{})).status,200);assert.equal(logs.includes('fake-private-warning-key'),false);
 const disk=fs.readFileSync(path.join(tmp,'data/ai-settings.json'),'utf8');const publicText=JSON.stringify((await (await request('/api/v1/ai/settings')).json()).data);
 for(const secret of [key,byok,direct]){assert.equal(disk.includes(secret),false);assert.equal(publicText.includes(secret),false);}
 assert.equal(fs.statSync(path.join(tmp,'data/ai-settings.json')).mode&0o777,0o600);
 const parsed=JSON.parse(disk);for(const secret of [parsed.secret,parsed.byokSecret,parsed.connections.openai.secret]) assert.equal(publicText.includes(secret),false);
 saved=await aiSettings({provider:'openai',model:'direct-model'});assert.equal(saved.response.status,200);assert.equal(saved.data.data.hasApiKey,true);
 assert.equal(saved.data.data.connections.vercel.hasByokKey,true);
 const settings=require('/app/server/dist/server/src/services/aiSettings.js');assert.equal(settings.configured().apiKey,direct);assert.equal(settings.configured().byokApiKey,undefined);
});
test('Gateway requires both keys for BYOK, never reuses another BYOK provider key, and sanitizes errors',async()=>{
 let saved=await aiSettings({provider:'vercel',model:'openai/test-model',gatewayMode:'byok',byokProvider:'openai'});assert.equal(saved.response.status,200);
 assert.equal((await aiSettings({byokProvider:'anthropic'})).response.status,400);
 assert.equal((await aiSettings({removeByokKey:true})).response.status,400);
 assert.equal((await aiSettings({removeKey:true})).response.status,400);
 assert.equal((await aiSettings({model:'missing-provider-prefix'})).response.status,400);
 assert.equal((await aiSettings({byokProvider:'http://foreign.invalid'})).response.status,400);
 await aiSettings({gatewayMode:'managed'});aiOutput({ok:true});assert.equal((await request('/api/v1/ai/test',{})).status,200);
 let call=JSON.parse(fs.readFileSync(process.env.AI_TEST_GATEWAY_LOG,'utf8').trim().split('\n').at(-1));assert.equal(call.body.providerOptions?.gateway,undefined);
 await aiSettings({gatewayMode:'byok'});aiOutput({},401);const failure=await request('/api/v1/ai/test',{});const message=await failure.text();assert.equal(failure.status,400);assert.match(message,/API key|permissions/);assert.equal(message.includes('fake-private-marker'),false);
 await aiSettings({enabled:false,removeByokKey:true});assert.equal((await request('/api/v1/ai/test',{})).status,400);
 saved=await aiSettings({gatewayMode:'managed',removeKey:true});assert.equal(saved.data.data.hasApiKey,false);assert.equal(saved.data.data.connections.openai.hasApiKey,true);
});
test('Gateway catalog normalizes its own prices, filters non-language models, and sends no credentials',async()=>{
 const catalog=require('/app/server/dist/server/src/services/modelCatalog.js');
 const data={data:[{id:'openai/gateway-model',name:'Gateway fixture',type:'language',modalities:{input:['text'],output:['text']},pricing:{input:'0.000002',output:'0.000008',input_cache_read:'0.000001'},context_window:128000,supported_parameters:['structured_outputs'],released:1735689600},{id:'openai/embedding',type:'embedding',modalities:{input:['text'],output:['text']}},{id:'lab/unknown',type:'language',modalities:{input:['text'],output:['text']}}]};
 const models=catalog.normalizeModels('vercel',data);assert.equal(models.length,2);const model=models.find(m=>m.id==='openai/gateway-model');assert.equal(model.inputPrice,2);assert.equal(model.outputPrice,8);assert.equal(model.cacheReadPrice,1);assert.equal(model.contextWindow,128000);assert.equal(model.structuredOutput,true);assert.equal(models.find(m=>m.id==='lab/unknown').inputPrice,null);
 fs.writeFileSync(fixtureFile,JSON.stringify({catalog:data}));const result=await (await request('/api/v1/ai/models?provider=vercel')).json();assert.equal(result.success,true);assert.equal(result.data.sourceType,'live');assert.equal(result.data.sourceURL,'https://ai-gateway.vercel.sh/v1/models');assert.equal(result.data.models.length,2);
 const call=fs.readFileSync(process.env.AI_TEST_CATALOG_LOG,'utf8').trim().split('\n').map(JSON.parse).find(c=>c.url==='https://ai-gateway.vercel.sh/v1/models');assert.equal(call.hasAuthorization,false);assert.equal(call.redirect,'error');
 assert.equal((await fetch(base+'/api/v1/ai/models?provider=vercel')).status,401);
});
test('Gateway offline catalog uses its bundled source and legacy settings migrate without losing keys',async()=>{
 const modulePath='/app/server/dist/server/src/services/modelCatalog.js';const original=global.fetch;const cacheFile=path.join(tmp,'data/ai-model-catalog.json'),priorCache=fs.readFileSync(cacheFile);
 try {fs.unlinkSync(cacheFile);delete require.cache[require.resolve(modulePath)];global.fetch=async()=>{throw new Error('offline');};const catalog=require(modulePath);const cached=await catalog.getModelCatalog('vercel',true);assert.equal(cached.sourceType,'snapshot');assert.ok(cached.models.length);assert.equal(cached.sourceName,'Vercel AI Gateway API');assert.match(cached.warning,/unavailable|catalog/i);
 }finally{global.fetch=original;fs.writeFileSync(cacheFile,priorCache);}
 const settings=require('/app/server/dist/server/src/services/aiSettings.js'),filename=path.join(tmp,'data/ai-settings.json');const previous=fs.readFileSync(filename,'utf8');
 try {const saved=JSON.parse(previous);const direct=saved.connections.openai;const legacy={...saved,provider:'openai',model:direct.model,secret:direct.secret};delete legacy.connections;delete legacy.byokSecret;delete legacy.gatewayMode;delete legacy.byokProvider;fs.writeFileSync(filename,JSON.stringify(legacy));
 const before=settings.publicSettings();assert.equal(before.hasApiKey,true);assert.equal(before.connections.openai.hasApiKey,true);settings.saveSettings({...before,enabled:false});assert.equal(settings.configured(false).apiKey,'fake-direct-retained');assert.equal(JSON.parse(fs.readFileSync(filename,'utf8')).secret,direct.secret);
 }finally{fs.writeFileSync(filename,previous);}
});

function publicationFixture(name) {
 const dir=path.join(root,name);fs.mkdirSync(dir);
 const git=(...args)=>execFileSync('/usr/bin/git',['-C',dir,...args],{encoding:'utf8'}).trim();
 git('init','-q','-b','main');git('config','user.name','Publication fixture');git('config','user.email','fixture@example.invalid');
 const commit=(text)=>{fs.writeFileSync(path.join(dir,'file.txt'),text+'\n');git('add','file.txt');git('commit','-qm',text);return git('rev-parse','HEAD');};
 return {dir,git,commit};
}
test('publication uses remote ancestry across pages and any remote, not tags or branch decorations',async()=>{
 const {dir,git,commit}=publicationFixture('publication-history');
 const base=commit('base'),published=commit('published'),local=commit('local');
 git('remote','add','origin','https://example.invalid/publication.git');git('update-ref','refs/remotes/origin/main',published);git('tag','local-tag',local);
 const beforeHead=git('rev-parse','HEAD'),beforeIndex=git('write-tree');
 let states=await services.getCommitPublication(dir,[base,published,local]);assert.equal(states.get(base),'published');assert.equal(states.get(published),'published');assert.equal(states.get(local),'local');
 const page=await services.getLogWithParents(dir,1,2);assert.equal(page.length,1);assert.equal(page[0].hash,base);assert.equal(page[0].publication,'published');
 git('update-ref','refs/remotes/backup/topic',local);states=await services.getCommitPublication(dir,[local]);assert.equal(states.get(local),'published');assert.equal((await services.getStatus(dir)).tracking,null);
 git('update-ref','-d','refs/remotes/backup/topic');git('reset','--soft',published);
 const history=await services.getLogWithParents(dir,100,0,true);assert.equal(history.find(c=>c.hash===local).publication,'local');
 git('reset','--soft',beforeHead);assert.equal(git('write-tree'),beforeIndex);assert.equal(git('status','--porcelain'),'');
});
test('history hides reflog-only commits by default and includes them only when requested, without changing Git state',async()=>{
 const {dir,git,commit}=publicationFixture('history-reflog');
 const base=commit('base');
 git('checkout','-qb','topic');const topic=commit('normal branch');git('checkout','main');
 const recovered=commit('before rewrite');git('reset','--hard',base);const head=commit('after rewrite');
 git('update-ref','refs/remotes/origin/main',base);git('tag','release',head);
 assert.equal(git('rev-list','--all').split('\n').includes(recovered),false);
 assert.ok(git('reflog','--format=%H').split('\n').includes(recovered));
 const snapshot=()=>[git('show-ref'),git('reflog','show','--all','--format=%H %gs'),git('rev-parse','HEAD'),git('write-tree'),git('status','--porcelain')];
 const before=snapshot();
 for(const mode of [undefined,false,true,false]) {
  const history=await services.getLogWithParents(dir,100,0,mode);
  assert.equal(history.some(c=>c.hash===recovered),mode===true);
  for(const hash of [base,topic,head])assert.ok(history.some(c=>c.hash===hash));
  assert.equal(history.find(c=>c.hash===base).publication,'published');
  assert.equal(history.find(c=>c.hash===topic).publication,'local');
  assert.ok(history.find(c=>c.hash===topic).branches.includes('topic'));
  assert.equal(history.find(c=>c.hash===head).isHead,true);
  assert.ok(history.find(c=>c.hash===head).tags.includes('release'));
  assert.deepEqual(history.find(c=>c.hash===head).parentHashes,[base]);
  if(mode)assert.equal(history.find(c=>c.hash===recovered).publication,'local');
 }
 for(const endpoint of ['log','graph']) {
  for(const mode of [undefined,'false','true','1']) {
   const url='/api/v1/git/'+endpoint+'?repo='+encodeURIComponent(dir)+'&limit=100'+(mode===undefined?'':'&showReflog='+mode);
   const response=await request(url);assert.equal(response.status,200);
   const {data}=await response.json();const commits=endpoint==='graph'?data.commits:data;
   assert.equal(commits.some(c=>c.hash===recovered),mode==='true');
   for(const hash of [base,topic,head])assert.ok(commits.some(c=>c.hash===hash));
   if(endpoint==='graph')assert.ok(commits.every(c=>Number.isInteger(c.lane)&&c.lane>=0&&c.lane<data.totalLanes));
   const paged=[];
   for(let skip=0;skip<commits.length;skip+=2) {
    const pageUrl=url.replace('limit=100','limit=2')+'&skip='+skip;
    const {data:pageData}=await (await request(pageUrl)).json();
    paged.push(...(endpoint==='graph'?pageData.commits:pageData).map(c=>c.hash));
   }
   assert.deepEqual(paged,commits.map(c=>c.hash));
  }
 }
 assert.deepEqual(snapshot(),before);
 assert.equal(git('cat-file','-t',recovered),'commit');
});
test('publication is local without remote refs and unknown on unavailable objects or invalid revisions',async()=>{
 const {dir,git,commit}=publicationFixture('publication-errors');const head=commit('only local');
 assert.equal((await services.getCommitPublication(dir,[head])).get(head),'local');
 git('update-ref','refs/remotes/origin/main',head);const missing='f'.repeat(40);
 assert.equal((await services.getCommitPublication(dir,[missing])).get(missing),'unknown');
 const invalid='--output=/tmp/publication-injected';assert.equal((await services.getCommitPublication(dir,[invalid])).get(invalid),'unknown');assert.equal(fs.existsSync('/tmp/publication-injected'),false);
 const overLimit=Array.from({length:501},()=>head);assert.equal((await services.getCommitPublication(dir,overLimit)).get(head),'unknown');assert.equal((await services.getCommitPublication(dir,[])).size,0);
});
test('branch publication distinguishes no upstream, remote sync, divergence, missing/local upstream and detached HEAD',async()=>{
 const {dir,git,commit}=publicationFixture('publication-branch');const base=commit('base'),head=commit('local');
 let status=await services.getStatus(dir);assert.equal(status.upstreamStatus,'none');assert.equal(status.detached,false);assert.equal(status.hasRemote,false);
 git('remote','add','team','https://example.invalid/team.git');assert.equal((await services.getStatus(dir)).hasRemote,true);
 git('remote','add','origin','https://example.invalid/publication.git');git('update-ref','refs/remotes/origin/main',base);git('branch','--set-upstream-to=origin/main');
 status=await services.getStatus(dir);assert.equal(status.upstreamStatus,'remote');assert.equal(status.ahead,1);assert.equal(status.behind,0);
 git('update-ref','refs/remotes/origin/main',head);status=await services.getStatus(dir);assert.equal(status.ahead,0);assert.equal(status.behind,0);
 const tree=git('rev-parse',base+'^{tree}'),remote=git('commit-tree',tree,'-p',base,'-m','remote side');git('update-ref','refs/remotes/origin/main',remote);status=await services.getStatus(dir);assert.equal(status.ahead,1);assert.equal(status.behind,1);
 git('update-ref','-d','refs/remotes/origin/main');assert.equal((await services.getStatus(dir)).upstreamStatus,'missing');
 git('branch','local-upstream',base);git('branch','--set-upstream-to=local-upstream');assert.equal((await services.getStatus(dir)).upstreamStatus,'local');
 git('checkout','--detach',head);assert.equal((await services.getStatus(dir)).detached,true);
});

test('repeated invalid form logins are bounded without blocking session checks or existing API credentials',async()=>{
 for(let i=0;i<10;i++) {
  const response=await fetch(base+'/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({username:'audit',password:'incorrect'})});
  assert.equal(response.status,401);
 }
 const blocked=await fetch(base+'/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({username:'audit',password})});
 assert.equal(blocked.status,429);assert.ok(Number(blocked.headers.get('retry-after'))>0);
 assert.equal((await fetch(base+'/api/v1/auth/session')).status,200);
 assert.equal((await request('/api/v1/health')).status,200);
});

function mergeToFixture(name) {
 const folder=path.join(root,name);fs.mkdirSync(folder);
 const run=(...args)=>execFileSync('/usr/bin/git',['-C',folder,...args],{encoding:'utf8'}).trim();
 run('init','-q','-b','main');run('config','user.name','Fixture');run('config','user.email','fixture@example.invalid');
 fs.writeFileSync(path.join(folder,'shared.txt'),'base\n');run('add','.');run('commit','-qm','base');
 run('checkout','-qb','feature');fs.writeFileSync(path.join(folder,'feature.txt'),'feature\n');run('add','.');run('commit','-qm','feature');
 return {folder,run};
}
test('Merge To integrates the active branch into a local destination and stays there, preserving the source',async()=>{
 const {folder,run}=mergeToFixture('merge-to-success'),source=run('rev-parse','feature');
 run('tag','feature','main'); // A same-name tag must never replace the source branch.
 const response=await request('/api/v1/git/merge-to',{repo:folder,sourceBranch:'feature',targetBranch:'main'});
 assert.equal(response.status,200);assert.equal((await response.json()).data.merged,true);
 assert.equal(run('branch','--show-current'),'main');assert.equal(run('rev-parse','HEAD'),source);assert.equal(run('rev-parse','refs/heads/feature'),source);
 assert.equal(fs.readFileSync(path.join(folder,'feature.txt'),'utf8'),'feature\n');
});
test('Merge To rejects dirty, stale, detached, invalid and nonlocal requests before switching branches',async()=>{
 const {folder,run}=mergeToFixture('merge-to-rejected'),head=run('rev-parse','HEAD');
 const body={repo:folder,sourceBranch:'feature',targetBranch:'main'};
 const unchanged=()=>{assert.equal(run('branch','--show-current'),'feature');assert.equal(run('rev-parse','HEAD'),head);};
 for(const dirty of ['untracked','unstaged','staged']){
  const filename=dirty==='untracked'?'new.txt':'shared.txt';fs.writeFileSync(path.join(folder,filename),'keep this work\n');if(dirty==='staged')run('add',filename);
  assert.equal((await request('/api/v1/git/merge-to',body)).ok,false);unchanged();assert.equal(fs.readFileSync(path.join(folder,filename),'utf8'),'keep this work\n');
  if(dirty==='untracked')fs.unlinkSync(path.join(folder,filename));else{run('reset','--',filename);run('checkout','--',filename);}
 }
 for(const fields of [{sourceBranch:'main'},{targetBranch:'feature'},{targetBranch:'origin/main'},{targetBranch:'--help'},{targetBranch:'main~1'},{targetBranch:'../main'},{targetBranch:42},{sourceBranch:['feature']},{targetBranch:''}]){
  assert.equal((await request('/api/v1/git/merge-to',{...body,...fields})).ok,false);unchanged();
 }
 run('checkout','--detach',head);assert.equal((await request('/api/v1/git/merge-to',body)).ok,false);assert.equal(run('branch','--show-current'),'');assert.equal(run('rev-parse','HEAD'),head);
});
test('Merge To reports conflicts on the destination and abort preserves both branch tips',async()=>{
 const {folder,run}=mergeToFixture('merge-to-conflict');
 fs.writeFileSync(path.join(folder,'shared.txt'),'feature version\n');run('add','.');run('commit','-qm','feature conflict');const source=run('rev-parse','HEAD');
 run('checkout','main');fs.writeFileSync(path.join(folder,'shared.txt'),'main version\n');run('add','.');run('commit','-qm','main conflict');const target=run('rev-parse','HEAD');run('checkout','feature');
 const response=await request('/api/v1/git/merge-to',{repo:folder,sourceBranch:'feature',targetBranch:'main'});assert.equal(response.status,200);
 const result=(await response.json()).data;assert.equal(result.merged,false);assert.deepEqual(result.conflicts,['shared.txt']);assert.equal(run('branch','--show-current'),'main');assert.equal(run('rev-parse','MERGE_HEAD'),source);
 assert.equal((await request('/api/v1/git/merge/abort',{repo:folder})).status,200);
 assert.equal(run('branch','--show-current'),'main');assert.equal(run('rev-parse','HEAD'),target);assert.equal(run('rev-parse','feature'),source);assert.equal(run('status','--porcelain'),'');
});
test('Merge To keeps the destination on a non-conflict merge failure without resetting either branch',async()=>{
 const {folder,run}=mergeToFixture('merge-to-failure'),source=run('rev-parse','HEAD');
 run('checkout','--orphan','unrelated');run('rm','-rf','.');fs.writeFileSync(path.join(folder,'other.txt'),'unrelated\n');run('add','.');run('commit','-qm','unrelated');const target=run('rev-parse','HEAD');run('checkout','feature');
 const response=await request('/api/v1/git/merge-to',{repo:folder,sourceBranch:'feature',targetBranch:'unrelated'});assert.equal(response.ok,false);assert.match((await response.json()).error,/Merge failed on unrelated/);
 assert.equal(run('branch','--show-current'),'unrelated');assert.equal(run('rev-parse','HEAD'),target);assert.equal(run('rev-parse','feature'),source);assert.equal(run('status','--porcelain'),'');
});

test('AI failure diagnostics distinguish Gateway provider errors without leaking payloads or credentials',async()=>{
 await aiSettings({provider:'vercel',model:'alibaba/test-model',apiKey:'fake-diagnostic-gateway-key',enabled:true,gatewayMode:'managed',responseMode:'structured',maxOutputTokens:2048});
 for(const [status,extra,code] of [
  [401,{},'authentication'],[403,{},'authentication'],[402,{},'quota'],[429,{},'rate_limit'],[404,{},'model_not_found'],
  [400,{errorType:'invalid_request_error',errorMessage:' response_format json_schema unsupported'},'unsupported_output'],
  [400,{errorType:'invalid_request_error',errorCode:'context_length_exceeded',errorMessage:' maximum context'},'context_limit'],
  [422,{},'invalid_request'],[500,{},'provider_unavailable'],[503,{},'provider_unavailable'],[504,{},'timeout'],[424,{},'provider_unavailable']
 ]){
  fs.writeFileSync(fixtureFile,JSON.stringify({status,secret:'private-diagnostics-payload-marker',...extra}));
  const response=await request('/api/v1/ai/test',{}),result=await response.json();assert.equal(response.status,400);assert.equal(result.aiError?.code,code,JSON.stringify(result));assert.equal(result.aiError.httpStatus,status);assert.match(result.aiError.requestId,/^[0-9a-f-]{36}$/);assert.equal(result.aiError.provider,'vercel');
  for(const secret of ['private-diagnostics-payload-marker','fake-diagnostic-gateway-key']){assert.equal(JSON.stringify(result).includes(secret),false);assert.equal(logs.includes(secret),false);}
 }
});
test('Smart Commit reports output budget, JSON and schema failures and recovers on a manual retry without altering Git state',async()=>{
 const {folder,run}=mergeToFixture('ai-output-diagnostics');fs.writeFileSync(path.join(folder,'shared.txt'),'staged\n');run('add','.');
 const head=run('rev-parse','HEAD'),tree=run('write-tree'),diff=run('diff','--cached');
 const group={title:'fix: fixture',description:'',files:['shared.txt']};
 const fail=async(fixture,expected)=>{
  fs.writeFileSync(fixtureFile,JSON.stringify(fixture));const response=await request('/api/v1/ai/smart-commit/preview',{repo:folder}),result=await response.json();assert.equal(response.status,400);assert.equal(result.aiError?.code,expected,JSON.stringify(result));assert.equal(result.data,undefined);assert.equal(run('rev-parse','HEAD'),head);assert.equal(run('write-tree'),tree);assert.equal(run('diff','--cached'),diff);assert.equal(JSON.stringify(result).includes('private-generated-content-marker'),false);assert.equal(logs.includes('private-generated-content-marker'),false);return result;
 };
 for(const responseMode of ['structured','json']){
  await aiSettings({responseMode});
  for(const rawText of ['', '{"groups":[{"title":"private-generated-content-marker']){
   const error=await fail({rawText,finishReason:'length',outputTokens:2048,reasoningTokens:2000},'output_limit');assert.match(error.error,/2048-token/);assert.equal(error.aiError.finishReason,'length');assert.equal(error.aiError.outputTokens,2048);assert.equal(error.aiError.reasoningTokens,2000);
  }
  await fail({rawText:'private-generated-content-marker invalid JSON'},'invalid_json');
  const invalid=await fail({output:{groups:[{...group,title:'private-generated-content-marker'.repeat(4)}]}},'invalid_response');assert.match(invalid.error,/groups\[0\]\.title/);assert.match(invalid.error,/72/);
  await fail({output:{groups:[group]},finishReason:'content-filter'},'content_filter');
  // Neither settings changes nor failures trigger a second generation implicitly.
  const calls=()=>fs.readFileSync(process.env.AI_TEST_GATEWAY_LOG,'utf8').trim().split('\n').length;
  const before=calls();await aiSettings({maxOutputTokens:4096});assert.equal(calls(),before);
  aiOutput({groups:[group]});const recovered=await (await request('/api/v1/ai/smart-commit/preview',{repo:folder})).json();assert.ok(recovered.data?.planId,JSON.stringify(recovered));assert.equal(run('rev-parse','HEAD'),head);assert.equal(run('write-tree'),tree);
  await aiSettings({maxOutputTokens:2048});
 }
 await aiSettings({responseMode:'structured'});
});
test('AI error cause chains and schema issue diagnostics expose only fixed metadata',()=>{
 const {diagnoseAIError}=require('/app/server/dist/server/src/services/aiErrors.js');
 const context={provider:'vercel',model:'fixture-model',responseMode:'structured',maxOutputTokens:2048,apiKey:'private-context-key',byokApiKey:'private-byok-key',connections:{secret:'private-connection-secret'}};
 const nested=diagnoseAIError({name:'GatewayInternalServerError',statusCode:500,cause:{name:'TimeoutError',message:'private-error-payload-marker',requestBodyValues:{apiKey:'private-secret'}}},context);assert.equal(nested.details.code,'timeout');
 const network=diagnoseAIError({statusCode:500,cause:{code:'ENOTFOUND',message:'private-error-payload-marker'}},context);assert.equal(network.details.code,'network');
 const unknown=diagnoseAIError(Error('private-error-payload-marker'),context);assert.equal(unknown.details.code,'unknown');
 const {z}=require('/app/node_modules/zod');const parsed=z.object({title:z.string().max(72)}).safeParse({title:'private-error-payload-marker'.repeat(10)});assert.equal(parsed.success,false);const schema=diagnoseAIError(parsed.error,context);assert.equal(schema.details.code,'invalid_response');assert.match(schema.message,/title/);
 for(const e of [nested,network,unknown,schema])assert.equal(JSON.stringify(e).includes('private-'),false);
});

test('local branch deletion protects the active branch, stale selections, unmerged commits and other worktrees',async()=>{
 const {folder,run}=mergeToFixture('delete-local');const main=run('rev-parse','main'),feature=run('rev-parse','feature');run('checkout','main');
 run('branch','merged/topic','main');run('update-ref','refs/remotes/origin/merged/topic',main);
 const remove=(branch,extra={})=>request('/api/v1/git/branch/delete',{repo:folder,branch,expectedCommit:branch==='main'?main:feature,...extra});
 assert.equal((await remove('main',{force:true})).ok,false);assert.equal(run('branch','--show-current'),'main');
 assert.equal((await remove('feature',{force:false})).ok,false);assert.equal(run('rev-parse','feature'),feature);
 assert.equal((await remove('feature',{expectedCommit:main,force:true})).ok,false);assert.equal(run('rev-parse','feature'),feature);
 for(const extra of [{expectedCommit:[]},{force:'false'},{expectedCommit:'HEAD~1'}])assert.equal((await remove('feature',extra)).ok,false);
 assert.equal((await remove('merged/topic',{expectedCommit:main})).status,200);assert.equal(run('rev-parse','refs/remotes/origin/merged/topic'),main);
 assert.equal((await remove('feature',{force:true})).status,200);assert.throws(()=>run('show-ref','--verify','refs/heads/feature'));
 run('branch','other-worktree','main');run('worktree','add','--quiet',path.join(root,'delete-other-worktree'),'other-worktree');assert.equal((await remove('other-worktree',{expectedCommit:main,force:true})).ok,false);assert.equal(run('rev-parse','other-worktree'),main);
});
function remoteDeleteFixture(name,remote='origin') {
 const {folder,run}=mergeToFixture(name);run('checkout','main');
 const bare=path.join(root,name+'-server.git');execFileSync('/usr/bin/git',['init','--bare','-q',bare]);
 run('push','--quiet',bare,'refs/heads/main:refs/heads/main','refs/heads/feature:refs/heads/old/topic');
 const tip=run('rev-parse','feature'),url='https://github.com/sikagit-fixture/disposable.git',log=path.join(tmp,name+'-push.jsonl');
 run('remote','add',remote,url);run('update-ref',`refs/remotes/${remote}/old/topic`,tip);run('branch','old/topic','feature');
 fs.writeFileSync(process.env.SIKAGIT_TEST_REMOTE_FIXTURE,JSON.stringify({url,bare,log}));
 const server=(...args)=>execFileSync('/usr/bin/git',['--git-dir',bare,...args],{encoding:'utf8'}).trim();
 const remove=(extra={})=>request('/api/v1/git/branch/delete-remote',{repo:folder,branch:`remotes/${remote}/old/topic`,expectedCommit:tip,...extra});
 return {folder,run,server,remove,tip,log,url};
}
test('remote branch deletion removes only the leased server branch and tracking ref, preserving local branches and tags',async()=>{
 const {run,server,remove,tip,log}=remoteDeleteFixture('delete-remote','team/origin');run('tag','keep-tag');
 const response=await remove({expectedCommit:tip.slice(0,7)});assert.equal(response.status,200,await response.text());
 assert.throws(()=>server('show-ref','--verify','refs/heads/old/topic'));assert.throws(()=>run('show-ref','--verify','refs/remotes/team/origin/old/topic'));
 assert.equal(run('rev-parse','old/topic'),tip);assert.equal(run('branch','--show-current'),'main');assert.equal(server('rev-parse','main'),run('rev-parse','main'));assert.throws(()=>server('show-ref','--verify','refs/tags/keep-tag'));
 const calls=fs.readFileSync(log,'utf8').trim().split('\n').map(JSON.parse);assert.equal(calls.length,1);assert(calls[0].includes(`--force-with-lease=refs/heads/old/topic:${tip}`));assert(calls[0].includes(':refs/heads/old/topic'));assert(calls[0].includes('--no-follow-tags'));assert(calls[0].includes('--recurse-submodules=no'));
});
test('remote deletion refuses stale remote tips and keeps tracking/local refs after a failed lease',async()=>{
 const {run,server,remove,tip}=remoteDeleteFixture('delete-remote-stale');const changed=run('rev-parse','main');server('update-ref','refs/heads/old/topic',changed);
 const response=await remove();assert.equal(response.ok,false);assert.match((await response.json()).error,/Fetch and review/);assert.equal(server('rev-parse','old/topic'),changed);assert.equal(run('rev-parse','refs/remotes/origin/old/topic'),tip);assert.equal(run('rev-parse','old/topic'),tip);
});
test('remote deletion rejects unsafe push targets, aliases, invalid refs and force flags before any network mutation',async()=>{
 const {run,server,remove,tip,log,url}=remoteDeleteFixture('delete-remote-reject');
 for(const extra of [{expectedCommit:undefined},{expectedCommit:[]},{expectedCommit:'--all'},{expectedCommit:run('rev-parse','main')},{branch:'remotes/origin/../main'},{branch:'remotes/origin/-bad'},{branch:'main'},{force:true},{force:false}])assert.equal((await remove(extra)).ok,false);
 run('symbolic-ref','refs/remotes/origin/HEAD','refs/remotes/origin/old/topic');assert.equal((await remove({branch:'remotes/origin/HEAD'})).ok,false);
 for(const target of ['https://foreign.invalid/a/b','file:///tmp/server.git','ext::sh -c true','https://github.com@foreign.invalid/a/b']){
  run('config','remote.origin.pushurl',target);assert.equal((await remove()).ok,false);assert.equal(server('rev-parse','old/topic'),tip);
 }
 run('config','--unset-all','remote.origin.pushurl');run('config','--add','remote.origin.pushurl',url);run('config','--add','remote.origin.pushurl',url);assert.equal((await remove()).ok,false);
 assert.equal(fs.existsSync(log),false);assert.equal(run('rev-parse','refs/remotes/origin/old/topic'),tip);assert.equal(run('rev-parse','old/topic'),tip);
});

async function cleanupPreview(folder,options={}) {
 const response=await request('/api/v1/git/branch/cleanup/preview',{repo:folder,...options});const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));return result.data;
}
const cleanupExecute=(folder,plan,refs,extra={})=>request('/api/v1/git/branch/cleanup/execute',{repo:folder,planId:plan.planId,refs,...extra});
test('merged cleanup uses exact ancestry, excludes squash/cherry-picks, primary branches and worktrees, and deletes only confirmed references',async()=>{
 const {folder,run}=mergeToFixture('cleanup-ancestry');run('checkout','main');run('merge','--ff-only','feature');run('branch','merged/topic');run('branch','master');run('branch','worktree/topic');run('worktree','add','--quiet',path.join(root,'cleanup-other-worktree'),'worktree/topic');
 run('checkout','-qb','squash/topic');fs.writeFileSync(path.join(folder,'squash.txt'),'squash\n');run('add','.');run('commit','-qm','squash source');run('checkout','main');run('merge','--squash','squash/topic');run('commit','-qm','squashed');
 run('checkout','-qb','cherry/topic');fs.writeFileSync(path.join(folder,'cherry.txt'),'cherry\n');run('add','.');run('commit','-qm','cherry source');run('checkout','main');run('commit','--allow-empty','-qm','diverge before cherry');run('cherry-pick','cherry/topic');
 const head=run('rev-parse','HEAD'),tree=run('write-tree'),plan=await cleanupPreview(folder,{baseRef:'refs/heads/main'});
 assert.deepEqual(plan.candidates.map(c=>c.name).sort(),['feature','merged/topic']);assert.equal(run('rev-parse','HEAD'),head);assert.equal(run('write-tree'),tree);
 const response=await cleanupExecute(folder,plan,['refs/heads/merged/topic']);assert.equal(response.status,200);assert.deepEqual((await response.json()).data.results.map(r=>r.status),['deleted']);
 assert.throws(()=>run('show-ref','--verify','refs/heads/merged/topic'));for(const name of ['main','master','feature','squash/topic','cherry/topic','worktree/topic'])assert(run('rev-parse',name));assert.equal(run('rev-parse','HEAD'),head);assert.equal(run('write-tree'),tree);
 assert.equal((await cleanupExecute(folder,plan,['refs/heads/feature'])).ok,false);
});
test('cleanup plans reject forged selections, force flags, stale tips/base, new checkouts and cross-repository execution before deleting anything',async()=>{
 const {folder,run}=mergeToFixture('cleanup-stale');run('checkout','main');run('merge','--ff-only','feature');run('branch','old/topic');
 let plan=await cleanupPreview(folder),refs=['refs/heads/feature'];
 for(const selected of [['refs/heads/main'],['refs/heads/feature','refs/heads/feature'],['--all'],[{}],[]])assert.equal((await cleanupExecute(folder,plan,selected)).ok,false);
 assert.equal((await cleanupExecute(folder,plan,refs,{force:true})).ok,false);assert.equal((await request('/api/v1/git/branch/cleanup/preview',{repo:folder,includeRemote:'false'})).status,400);
 const other=mergeToFixture('cleanup-other-repo');assert.equal((await cleanupExecute(other.folder,plan,refs)).ok,false);
 run('commit','--allow-empty','-qm','new base');assert.equal((await cleanupExecute(folder,plan,refs)).ok,false);assert(run('rev-parse','feature'));
 plan=await cleanupPreview(folder);run('update-ref','refs/heads/feature',run('rev-parse','main'));assert.equal((await cleanupExecute(folder,plan,refs)).ok,false);
 plan=await cleanupPreview(folder);run('checkout','feature');assert.equal((await cleanupExecute(folder,plan,refs)).ok,false);assert(run('rev-parse','old/topic'));
});
test('remote cleanup uses only the chosen published main/master, ignores unpublished merges and preserves other remotes and local counterparts',async()=>{
 const {folder,run,server,tip,url,log}=remoteDeleteFixture('cleanup-remote');const original=run('rev-parse','main');run('update-ref','refs/remotes/origin/main',original);run('merge','--ff-only','feature');
 let plan=await cleanupPreview(folder,{baseRef:'refs/remotes/origin/main',includeLocal:false,includeRemote:true});assert.equal(plan.candidates.length,0);
 assert.equal((await request('/api/v1/git/branch/cleanup/preview',{repo:folder,baseRef:'refs/heads/main',includeRemote:true})).ok,false);
 server('update-ref','refs/heads/main',tip);run('update-ref','refs/remotes/origin/main',tip);run('remote','add','upstream',url);run('update-ref','refs/remotes/upstream/main',tip);run('update-ref','refs/remotes/upstream/old/topic',tip);run('symbolic-ref','refs/remotes/origin/HEAD','refs/remotes/origin/main');
 plan=await cleanupPreview(folder,{baseRef:'refs/remotes/origin/main',includeLocal:false,includeRemote:true});assert.deepEqual(plan.candidates.map(c=>c.name),['remotes/origin/old/topic']);
 const response=await cleanupExecute(folder,plan,plan.candidates.map(c=>c.ref));assert.equal(response.status,200);assert.equal((await response.json()).data.results[0].status,'deleted');
 assert.throws(()=>server('show-ref','--verify','refs/heads/old/topic'));assert.equal(run('rev-parse','old/topic'),tip);assert.equal(run('rev-parse','refs/remotes/upstream/old/topic'),tip);assert.equal(server('rev-parse','main'),tip);assert.equal(fs.readFileSync(log,'utf8').trim().split('\n').length,1);
});
test('cleanup checks the current remote base before any local or remote deletion',async()=>{
 const {folder,run,server,tip,log}=remoteDeleteFixture('cleanup-remote-base');const original=run('rev-parse','main');server('update-ref','refs/heads/main',tip);run('update-ref','refs/remotes/origin/main',tip);
 const plan=await cleanupPreview(folder,{baseRef:'refs/remotes/origin/main',includeLocal:true,includeRemote:true});server('update-ref','refs/heads/main',original);
 const response=await cleanupExecute(folder,plan,['refs/heads/old/topic','refs/remotes/origin/old/topic']);assert.equal(response.ok,false);assert.match((await response.json()).error,/remote main\/master changed/);assert.equal(run('rev-parse','old/topic'),tip);assert.equal(server('rev-parse','old/topic'),tip);assert.equal(fs.existsSync(log),false);
});
test('cleanup reports partial results, stops remote deletion after a stale lease and never retries a consumed plan',async()=>{
 const {folder,run,server,tip,log}=remoteDeleteFixture('cleanup-partial');const original=run('rev-parse','main');run('merge','--ff-only','feature');server('update-ref','refs/heads/main',tip);run('update-ref','refs/remotes/origin/main',tip);server('update-ref','refs/heads/old/second',tip);run('update-ref','refs/remotes/origin/old/second',tip);
 const plan=await cleanupPreview(folder,{baseRef:'refs/remotes/origin/main',includeRemote:true});server('update-ref','refs/heads/old/topic',original);
 const refs=['refs/heads/old/topic','refs/remotes/origin/old/topic','refs/remotes/origin/old/second'];const response=await cleanupExecute(folder,plan,refs);assert.equal(response.status,200);const result=(await response.json()).data;assert.deepEqual(result.results.map(r=>r.status),['deleted','failed','skipped']);assert.match(result.results[1].message,/Fetch and review/);assert.equal(server('rev-parse','old/second'),tip);assert.equal(server('rev-parse','old/topic'),original);assert.equal(fs.readFileSync(log,'utf8').trim().split('\n').length,1);assert.equal((await cleanupExecute(folder,plan,refs)).ok,false);
});
test('cleanup previews are bounded and expire without mutating repository state',async()=>{
 const {folder,run}=mergeToFixture('cleanup-bounds');run('checkout','main');const hash=run('rev-parse','HEAD');
 execFileSync('/usr/bin/git',['-C',folder,'update-ref','--stdin'],{input:Array.from({length:205},(_,i)=>`create refs/heads/old/${i.toString().padStart(3,'0')} ${hash}`).join('\n')+'\n',encoding:'utf8'});
 const cleanup=require('/app/server/dist/server/src/services/branchCleanup.js');const plan=await cleanup.previewBranchCleanup(folder,{includeLocal:true,includeRemote:false});assert.equal(plan.candidates.length,200);assert.equal(plan.totalCandidates,205);assert.equal(run('rev-parse','HEAD'),hash);
 const now=Date.now;try{Date.now=()=>plan.expiresAt+1;await assert.rejects(()=>cleanup.executeBranchCleanup(folder,plan.planId,[plan.candidates[0].ref]),/expired/);}finally{Date.now=now;}
 assert.equal(run('for-each-ref','--format=%(refname)','refs/heads/old').split('\n').length,205);
});

test('explicit fast-forward overrides repository merge.ff=false for Merge and Merge To',async()=>{
 for(const endpoint of ['/merge','/merge-to']){
  const {folder,run}=mergeToFixture('explicit-ff-'+endpoint.slice(1));
  const source=run('rev-parse','feature');run('config','merge.ff','false');
  if(endpoint==='/merge')run('checkout','main');
  const response=await request('/api/v1/git'+endpoint,{repo:folder,sourceBranch:'feature',targetBranch:'main',fastForward:true});
  assert.equal(response.status,200);assert.equal((await response.json()).data.merged,true);
  assert.equal(run('branch','--show-current'),'main');assert.equal(run('rev-parse','HEAD'),source);
  assert.equal(run('log','-1','--format=%P').split(' ').length,1);assert.equal(run('rev-parse','feature'),source);
 }
});
test('disabling fast-forward creates a two-parent merge without forcing source deletion',async()=>{
 for(const endpoint of ['/merge','/merge-to']){
  const {folder,run}=mergeToFixture('no-ff-'+endpoint.slice(1));
  const source=run('rev-parse','feature'),target=run('rev-parse','main');run('config','merge.ff','only');
  if(endpoint==='/merge')run('checkout','main');
  const response=await request('/api/v1/git'+endpoint,{repo:folder,sourceBranch:'feature',targetBranch:'main',fastForward:false});
  assert.equal(response.status,200);assert.equal((await response.json()).data.merged,true);
  assert.equal(run('branch','--show-current'),'main');assert.notEqual(run('rev-parse','HEAD'),source);
  assert.deepEqual(run('log','-1','--format=%P').split(' '),[target,source]);assert.equal(run('rev-parse','feature'),source);
  assert.equal((await request('/api/v1/git/branch/delete',{repo:folder,branch:'feature',force:false,expectedCommit:source})).status,200);
  assert.equal(run('branch','--list','feature'),'');
 }
});
test('allow fast-forward still merges diverged branches rather than requiring ff-only',async()=>{
 for(const endpoint of ['/merge','/merge-to']){
  const {folder,run}=mergeToFixture('diverged-ff-'+endpoint.slice(1));const source=run('rev-parse','feature');
  run('checkout','main');fs.writeFileSync(path.join(folder,'main-only.txt'),'target work\n');run('add','.');run('commit','-qm','target change');const target=run('rev-parse','HEAD');
  if(endpoint==='/merge-to')run('checkout','feature');
  const response=await request('/api/v1/git'+endpoint,{repo:folder,sourceBranch:'feature',targetBranch:'main',fastForward:true});
  assert.equal(response.status,200);assert.equal((await response.json()).data.merged,true);
  assert.deepEqual(run('log','-1','--format=%P').split(' '),[target,source]);assert.equal(run('rev-parse','feature'),source);
  assert.equal(fs.readFileSync(path.join(folder,'feature.txt'),'utf8'),'feature\n');assert.equal(fs.readFileSync(path.join(folder,'main-only.txt'),'utf8'),'target work\n');
 }
});
test('merge endpoints reject non-boolean fast-forward options before touching branches',async()=>{
 const {folder,run}=mergeToFixture('invalid-ff-option'),source=run('rev-parse','feature'),target=run('rev-parse','main');
 for(const endpoint of ['/merge','/merge-to'])for(const fastForward of [null,'false','--ff-only',0,1,[],{}]){
  const response=await request('/api/v1/git'+endpoint,{repo:folder,sourceBranch:'feature',targetBranch:'main',fastForward});
  assert.equal(response.status,400);assert.match((await response.json()).error,/fastForward must be a boolean/);
  assert.equal(run('branch','--show-current'),'feature');assert.equal(run('rev-parse','HEAD'),source);assert.equal(run('rev-parse','main'),target);assert.equal(run('status','--porcelain'),'');
 }
});
