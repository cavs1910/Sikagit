// All preview/deletion requests are mocked; never deletes real branches.
const {chromium}=require(process.env.SIKAGIT_BROWSER_CLIENT||'playwright');
const assert=require('node:assert/strict');
const origin=process.env.SIKAGIT_TEST_ORIGIN||'http://127.0.0.1:5184';
(async()=>{
 const browser=await chromium.launch();
 try{for(const width of [320,390,1280]){
  const page=await browser.newPage({viewport:{width,height:844}});page.setDefaultTimeout(10000);
  const commit='a'.repeat(40),errors=[],writes=[];let fail=true,hold=false,release,delayPreview=false,releasePreview;
  const bases=[['refs/heads/main','main',false],['refs/heads/master','master',false],['refs/remotes/origin/main','remotes/origin/main',true]].map(([ref,name,isRemote])=>({ref,name,isRemote,commit}));
  let candidates=[['refs/heads/merged/a','merged/a',false],['refs/heads/merged/b','merged/b',false],['refs/remotes/origin/merged/b','remotes/origin/merged/b',true]].map(([ref,name,isRemote])=>({ref,name,isRemote,commit}));
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('sikagit-ui',JSON.stringify({version:4,state:{autoFetchOnOpen:false}})));
  await page.route('**/socket.io/**',r=>r.abort());
  await page.route('**/api/v1/**',async route=>{
   const req=route.request(),part=new URL(req.url()).pathname.replace('/api/v1','');let data={};
   if(part==='/auth/session')data={authenticated:true,expiresAt:Date.now()+86400000};
   if(part==='/repos')data=[{id:'fixture',name:'Fixture repository',path:'/repos/fixture',displayPath:'/repos/fixture'}];
   if(part==='/projects'||part==='/git/tags')data=[];
   if(part==='/ai/settings')data={enabled:false,hasApiKey:false};
   if(part==='/git/status')data={current:'main',tracking:'origin/main',hasRemote:true,ahead:0,behind:0,files:[],staged:[],unstaged:[],untracked:[],conflicted:[]};
   if(part==='/git/branches')data=[{name:'main',current:true,isRemote:false,commit},{name:'feature',current:false,isRemote:false,commit}];
   if(part==='/git/graph')data={totalLanes:1,commits:[]};
   if(part==='/git/branch/cleanup/preview'){
    if(delayPreview)await new Promise(resolve=>{releasePreview=resolve});
    const body=req.postDataJSON(),base=bases.find(b=>b.ref===body.baseRef)||bases.find(b=>!body.includeRemote||b.isRemote);
    data={planId:'fixture-plan',expiresAt:Date.now()+900000,base,bases,candidates:candidates.filter(c=>c.isRemote?body.includeRemote:body.includeLocal),totalCandidates:candidates.length,limit:200};
   }
   if(req.method()==='POST'&&part!=='/git/branch/cleanup/preview'&&!part.startsWith('/git/status-summary')){
    const body=req.postDataJSON();writes.push({part,...body});
    if(fail)return route.fulfill({status:400,json:{success:false,error:'The base or selected branches changed. Generate a new cleanup preview. Nothing was deleted.'}});
    if(hold)await new Promise(resolve=>{release=resolve});
    const results=body.refs.map(ref=>({...candidates.find(c=>c.ref===ref),status:ref.includes('refs/remotes/')&&body.refs.length>1?'failed':'deleted',message:ref.includes('refs/remotes/')&&body.refs.length>1?'Remote changed. Fetch and preview again.':undefined}));
    candidates=candidates.filter(c=>!results.some(r=>r.ref===c.ref&&r.status==='deleted'));data={results};
   }
   await route.fulfill({json:{success:true,data}});
  });
  await page.goto(origin+'/r/fixture');await page.getByTitle(/^Current branch: main/).click();await page.getByRole('button',{name:'Clean up merged branches…',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Clean up merged branches',exact:true});
  await dialog.getByRole('checkbox',{name:'Delete local merged/a',exact:true}).waitFor();assert.equal(writes.length,0);assert(await dialog.getByRole('checkbox',{name:'Remote branches on this remote',exact:true}).isDisabled());assert.equal(await dialog.getByRole('checkbox',{name:'Delete local main',exact:true}).count(),0);assert(await dialog.getByText(/Squash merges and cherry-picks/).isVisible());
  await dialog.getByRole('button',{name:'Deselect all',exact:true}).click();assert(await dialog.getByRole('button',{name:'Delete selected (0)',exact:true}).isDisabled());await dialog.getByRole('button',{name:'Select all',exact:true}).click();
  delayPreview=true;await dialog.getByRole('combobox',{name:'Cleanup base branch'}).selectOption('refs/remotes/origin/main');assert(await dialog.getByRole('button',{name:'Delete selected (0)',exact:true}).isDisabled());while(!releasePreview)await new Promise(r=>setTimeout(r,10));delayPreview=false;releasePreview();await dialog.getByRole('checkbox',{name:'Remote branches on this remote',exact:true}).check();await dialog.getByRole('checkbox',{name:'Delete remote origin/merged/b',exact:true}).waitFor();
  await dialog.getByRole('checkbox',{name:'Delete local merged/b',exact:true}).uncheck();
  await dialog.getByRole('button',{name:'Delete selected (2)',exact:true}).click();await page.getByRole('heading',{name:'Delete merged branches?',exact:true}).waitFor();assert.equal(writes.length,0);await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(writes.length,0);
  await dialog.getByRole('button',{name:'Delete selected (2)',exact:true}).click();await page.getByRole('button',{name:'Delete selected branches',exact:true}).click();await dialog.getByRole('alert').waitFor();assert.equal(writes.length,1);assert.deepEqual(writes[0].refs.sort(),['refs/heads/merged/a','refs/remotes/origin/merged/b']);assert.equal(writes[0].force,undefined);assert(await dialog.getByRole('button',{name:'Delete selected (2)',exact:true}).isDisabled());
  fail=false;await dialog.getByRole('button',{name:'Refresh preview',exact:true}).click();await dialog.getByRole('checkbox',{name:'Delete remote origin/merged/b',exact:true}).waitFor();await dialog.getByRole('checkbox',{name:'Delete local merged/b',exact:true}).uncheck();
  hold=true;await dialog.getByRole('button',{name:'Delete selected (2)',exact:true}).click();await page.getByRole('button',{name:'Delete selected branches',exact:true}).click();await dialog.getByRole('button',{name:'Cleaning branches…',exact:true}).waitFor();assert(await dialog.getByRole('button',{name:'Close branch cleanup',exact:true}).isDisabled());while(!release)await new Promise(r=>setTimeout(r,10));hold=false;release();await dialog.getByText('1 deleted · 1 failed · 0 skipped',{exact:true}).waitFor();await dialog.getByText('Remote changed. Fetch and preview again.',{exact:true}).waitFor();
  await dialog.getByRole('button',{name:'Refresh preview',exact:true}).click();await dialog.getByRole('checkbox',{name:'Delete remote origin/merged/b',exact:true}).waitFor();await dialog.getByRole('checkbox',{name:'Local branches',exact:true}).uncheck();await dialog.getByRole('button',{name:'Delete selected (1)',exact:true}).click();await page.getByRole('button',{name:'Delete selected branches',exact:true}).click();await dialog.getByText('1 deleted · 0 failed · 0 skipped',{exact:true}).waitFor();
  await dialog.getByRole('button',{name:'Refresh preview',exact:true}).click();await dialog.getByText('No merged branches to delete in this scope.',{exact:true}).waitFor();
  // Selecting a local base from remote-only scope restores a valid local scope.
  await dialog.getByRole('combobox',{name:'Cleanup base branch'}).selectOption('refs/heads/main');await dialog.getByRole('checkbox',{name:'Delete local merged/b',exact:true}).waitFor();assert(await dialog.getByRole('checkbox',{name:'Local branches',exact:true}).isChecked());assert(!(await dialog.getByRole('checkbox',{name:'Remote branches on this remote',exact:true}).isChecked()));
  assert(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth));assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);assert.equal(writes.length,3);assert(writes.every(w=>w.part==='/git/branch/cleanup/execute'));
  console.log(`PASS ${width}px: merged-branch preview, base/scope selection, selection/cancel, stale preview, busy controls, partial results and explicit remote cleanup`);await page.close();
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
