// Vite fixture: all Git/API responses are mocked, including delayed replies.
const { chromium } = require(process.env.SIKAGIT_BROWSER_CLIENT || 'playwright');
const assert = require('node:assert/strict');
const origin = process.env.SIKAGIT_TEST_ORIGIN || 'http://127.0.0.1:5184';
async function until(predicate) {
 for (let i=0;i<150;i++) { if(await predicate())return;await new Promise(r=>setTimeout(r,20)); }
 throw Error('Timed out waiting for repository fixture');
}
(async()=>{
 const browser=await chromium.launch();
 try {for(const width of [320,390,1280]) {
  const page=await browser.newPage({viewport:{width,height:844},hasTouch:width<768,isMobile:width<768});page.setDefaultTimeout(10000);
  const errors=[],requests=[],held=[],hold=new Set(),deleted=[];
  let repos=['a','b'].map(id=>({id,name:id==='a'?'Alpha repository':'Beta repository',path:'/repos/'+id,displayPath:'/repos/'+id}));
  await page.addInitScript(()=>{if(!localStorage.getItem('sikagit-ui'))localStorage.setItem('sikagit-ui',JSON.stringify({version:4,state:{autoFetchOnOpen:false}}));});
  page.on('pageerror',error=>errors.push(error.message));
  const hashes={a:'a'.repeat(40),b:'b'.repeat(40)};
  const versions={a:0,b:0};
  await page.route('**/socket.io/**',r=>r.abort());
  await page.route('**/api/v1/**',async route=>{
   const url=new URL(route.request().url()),part=url.pathname.replace('/api/v1',''),repo=url.searchParams.get('repo')?.split('/').pop(),version=versions[repo]||0;
   requests.push({part,repo,query:url.search});
   let data={};
   if(part==='/repos')data=repos;
   if(part.startsWith('/repos/')&&route.request().method()==='DELETE'){const id=part.split('/').pop();deleted.push(id);repos=repos.filter(r=>r.id!==id);}
   if(part==='/projects')data=[];
   if(part==='/auth/session')data={authenticated:true,expiresAt:Date.now()+86400000};
   if(part==='/ai/settings')data={enabled:false,hasApiKey:false};
   const branch=repo+'-branch-'+version;
   if(part==='/git/status')data={current:branch,tracking:'origin/main',upstreamStatus:'remote',hasRemote:true,remoteUrl:'https://github.com/fixture/'+repo,ahead:version,behind:0,files:[{path:repo+'.txt',index:' ',workingDir:'M',isStaged:false}],staged:[],unstaged:[{path:repo+'.txt',index:' ',workingDir:'M',isStaged:false}],untracked:[],conflicted:[]};
   if(part==='/git/branches')data=[{name:branch,current:true,isRemote:false,commit:hashes[repo]}];
   if(part==='/git/tags')data=[{name:repo+'-tag-'+version,commit:hashes[repo]}];
   if(part==='/git/graph')data={totalLanes:1,commits:[{hash:hashes[repo],abbreviatedHash:repo.repeat(7),authorName:'Fixture',authorEmail:'fixture@example.invalid',authorDate:'2026-11-04T12:00:00Z',message:repo+' commit '+version,body:'',parentHashes:[],branches:[branch],tags:[],isHead:true,publication:'published',lane:0,laneColor:0,connections:[]}]};
   if(part==='/git/commit-files')data=[{path:repo+'-commit.txt',status:'M'}];
   if(part.includes('diff'))data={diff:'',suppressed:[]};
   if(part==='/git/config')data={userName:'Fixture',userEmail:'fixture@example.invalid',remoteUrl:''};
   if(part==='/editor/tree')data=[{name:'normal.txt',path:'normal.txt',type:'file'},...(url.searchParams.get('showIgnored')==='true'?[{name:'ignored.txt',path:'ignored.txt',type:'file'}]:[])];
   if(hold.has(part+':'+repo))await new Promise(release=>held.push({part,repo,version,release}));
   await route.fulfill({json:{success:true,data}});
  });
  const snapshot=()=>page.evaluate(async()=>{
   const{useRepoStore}=await import('/src/store/repoStore.ts'),{useStatusStore}=await import('/src/store/statusStore.ts'),{useLogStore}=await import('/src/store/logStore.ts');
   const s=useStatusStore.getState(),l=useLogStore.getState();
   return {active:useRepoStore.getState().activeRepoId,repo:s.loadedRepo,current:s.status?.current,branches:s.branches.map(b=>b.name),tags:s.tags.map(t=>t.name),loading:s.loading,commits:l.commits.map(c=>c.message),logLoading:l.loading,selected:l.selectedCommit,file:s.selectedFile,pending:[...s.pendingStaged],files:l.commitFiles.map(f=>f.path)};
  });
  const select=async id=>{
   await page.evaluate(async id=>{const{useRepoStore}=await import('/src/store/repoStore.ts');useRepoStore.getState().setActiveRepo(id);},id);
   return snapshot();
  };
  const release=(repo,part)=>{hold.delete(part+':'+repo);for(const r of held.splice(0).filter(r=>{if(r.repo===repo&&r.part===part){r.release();return false;}return true;}))held.push(r);};
  const all=['/git/status','/git/branches','/git/tags','/git/graph'];
  await page.goto(origin+'/r/a');await until(async()=>{const s=await snapshot();return s.current==='a-branch-0'&&!s.loading&&!s.logLoading;});
  assert.equal((await snapshot()).current,'a-branch-0');
  if(width<768){const header=page.locator('header');assert.equal(await header.getByText('SikaGit',{exact:true}).count(),0);assert(await header.getByTitle('Alpha repository',{exact:true}).isVisible());assert.equal(await header.getByRole('button',{name:'Repository settings',exact:true}).count(),1);}
  assert.equal(await page.getByRole('button',{name:'Remove repository',exact:true}).count(),0);
  await page.evaluate(async()=>{const{useLogStore}=await import('/src/store/logStore.ts'),{useStatusStore}=await import('/src/store/statusStore.ts');useLogStore.getState().selectCommit('a'.repeat(40));useStatusStore.getState().selectFile('a.txt','unstaged');useStatusStore.getState().applyOptimisticStage(['a.txt']);});
  for(const part of all)hold.add(part+':b');
  let s=await select('b');assert.equal(s.repo,'/repos/b');assert.equal(s.current,undefined);assert.deepEqual(s.branches,[]);assert.deepEqual(s.tags,[]);assert.deepEqual(s.commits,[]);assert.equal(s.selected,null);assert.equal(s.file,null);assert.deepEqual(s.pending,[]);
  await page.getByTitle('Beta repository',{exact:true}).waitFor();assert(await page.getByRole('button',{name:/Loading branches/}).isDisabled());
  assert.equal(await page.getByRole('link',{name:'Open repository on GitHub',exact:true}).count(),0);
  for(const part of all)hold.add(part+':a');
  s=await select('a');assert.equal(s.current,'a-branch-0');assert.deepEqual(s.commits,['a commit 0']);assert.deepEqual(s.pending,['a.txt']);
  await until(()=>held.filter(r=>r.repo==='a').length>=4);
  await select('b');for(const part of all)release('a',part);await new Promise(r=>setTimeout(r,120));
  s=await snapshot();assert.equal(s.active,'b');assert.equal(s.current,undefined);assert.deepEqual(s.commits,[]);assert.deepEqual(s.branches,[]);assert.deepEqual(s.tags,[]);
  release('b','/git/status');await until(async()=>(await snapshot()).current==='b-branch-0');
  assert(await page.getByTitle(/^Current branch: b-branch-0/).isDisabled());
  for(const part of all)release('b',part);await until(async()=>!(await snapshot()).loading&&!(await snapshot()).logLoading);
  s=await snapshot();assert.deepEqual(s.commits,['b commit 0']);assert.deepEqual(s.branches,['b-branch-0']);assert.deepEqual(s.tags,['b-tag-0']);assert.deepEqual(s.pending,[]);
  assert.match(await page.getByRole('link',{name:'Open repository on GitHub',exact:true}).getAttribute('href'),/\/b$/);
  await page.evaluate(async()=>{const{useStatusStore}=await import('/src/store/statusStore.ts');useStatusStore.getState().applyOptimisticStage(['b.txt']);useStatusStore.getState().clearPendingForPaths(['a.txt'],'/repos/a');});
  assert.deepEqual((await snapshot()).pending,['b.txt']);
  // Raw selection changes cover URL restore/back-forward paths too.
  await page.evaluate(async()=>{const{useRepoStore}=await import('/src/store/repoStore.ts');useRepoStore.setState({activeRepoId:'a'});});
  s=await snapshot();assert.equal(s.current,'a-branch-0');assert.deepEqual(s.commits,['a commit 0']);assert.deepEqual(s.pending,[]);
  await until(async()=>!(await snapshot()).loading&&!(await snapshot()).logLoading);
  // Same-repo requests completing out of order must also keep the newest data.
  for(const [part,method,field,expected] of [['/git/status','fetchStatus','current','a-branch-2'],['/git/branches','fetchBranches','branches',['a-branch-2']],['/git/tags','fetchTags','tags',['a-tag-2']],['/git/graph','fetchLog','commits',['a commit 2']]]){
   hold.add(part+':a');versions.a=1;
   const fetch=()=>page.evaluate(async({method,part})=>{const store=part==='/git/graph'?(await import('/src/store/logStore.ts')).useLogStore:(await import('/src/store/statusStore.ts')).useStatusStore;void store.getState()[method]('/repos/a');},{method,part});
   await fetch();await until(()=>held.some(r=>r.part===part&&r.version===1));versions.a=2;await fetch();await until(()=>held.some(r=>r.part===part&&r.version===2));
   held.find(r=>r.part===part&&r.version===2).release();await until(async()=>JSON.stringify((await snapshot())[field])===JSON.stringify(expected));
   release('a',part);await new Promise(r=>setTimeout(r,80));assert.deepEqual((await snapshot())[field],expected);
  }
  // Commit files are scoped to both the repository and selection.
  hold.add('/git/commit-files:a');await page.evaluate(async()=>{const{useLogStore}=await import('/src/store/logStore.ts');useLogStore.getState().selectCommit('a'.repeat(40));void useLogStore.getState().fetchCommitFiles('/repos/a','a'.repeat(40));});
  await until(()=>held.some(r=>r.part==='/git/commit-files'&&r.repo==='a'));await select('b');
  await page.evaluate(async()=>{const{useLogStore}=await import('/src/store/logStore.ts');useLogStore.getState().selectCommit('b'.repeat(40));void useLogStore.getState().fetchCommitFiles('/repos/b','b'.repeat(40));});
  await until(async()=>(await snapshot()).files.includes('b-commit.txt'));release('a','/git/commit-files');await new Promise(r=>setTimeout(r,80));assert.deepEqual((await snapshot()).files,['b-commit.txt']);
  assert(!requests.some(r=>r.part==='/git/commit-files'&&r.repo==='b'&&r.query.includes('a'.repeat(40))));
  await page.getByRole('tab',{name:'Files',exact:true}).click();
  const toggle=page.getByRole('switch',{name:'Show Git-ignored files',exact:true});await toggle.waitFor();
  assert.equal(await toggle.getAttribute('aria-checked'),'false');assert(await toggle.evaluate(el=>el.parentElement.querySelector('[role="tablist"]')!==null));
  await toggle.click();await page.getByRole('button',{name:'ignored.txt',exact:true}).waitFor();assert.equal(await page.getByRole('checkbox',{name:'Show Git-ignored files'}).count(),0);
  const header=width<768?page.locator('header'):page.locator('.repo-toolbar');
  await header.getByRole('button',{name:'Repository settings',exact:true}).click();
  await page.getByRole('button',{name:'Remove repository',exact:true}).click();
  await page.getByText(/This will not delete repository files on disk/).waitFor();assert.deepEqual(deleted,[]);
  await page.getByRole('button',{name:'Cancel',exact:true}).last().click();assert.deepEqual(deleted,[]);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
  await page.getByRole('button',{name:'Remove repository',exact:true}).click();
  await page.getByRole('button',{name:'Remove',exact:true}).last().click();
  await until(()=>deleted.length===1);assert.deepEqual(deleted,['b']);
  await until(async()=>(await snapshot()).repo===null);assert.deepEqual((await snapshot()).commits,[]);
  await select('a');
  // Reload discards memory caches but retains the ignored-files preference.
  await page.reload();await page.getByRole('tab',{name:'Files',exact:true}).click();await toggle.waitFor();assert.equal(await toggle.getAttribute('aria-checked'),'true');
  console.log(`PASS ${width}px: scoped caches, cold loading, background/out-of-order replies, commit files, mobile header, shared switches and safe removal`);
  await page.close();
 }}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
