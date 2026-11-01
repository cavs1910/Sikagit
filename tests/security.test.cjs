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
const child = spawn(process.execPath,['/app/server/dist/server/src/index.js'],{env:process.env,stdio:['ignore','ignore','pipe']});
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
test('AI and foreign remote/config commands stay disabled',async()=>{
 assert.equal((await request('/api/v1/ai/suggest',{repo})).status,403);
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
