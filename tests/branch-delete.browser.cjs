// API mutations are mocked. No real Git repositories or network remotes.
const {chromium}=require(process.env.SIKAGIT_BROWSER_CLIENT||'playwright');
const assert=require('node:assert/strict');
const origin=process.env.SIKAGIT_TEST_ORIGIN||'http://127.0.0.1:5184';
(async()=>{
 const browser=await chromium.launch();
 try{for(const width of [320,390,1280]){
  const page=await browser.newPage({viewport:{width,height:844}});page.setDefaultTimeout(10000);
  const commit='a'.repeat(40),long='old/'+('verylongbranchname'.repeat(8));
  let branches=['main','old/topic',long,'remotes/origin/old/topic','remotes/origin/HEAD'].map(name=>({name,current:name==='main',isRemote:name.startsWith('remotes/'),commit}));
  const writes=[],errors=[];let held,waitForRemote=false,failRemote=true;
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
   if(part==='/git/branches')data=branches;
   if(part==='/git/graph')data={totalLanes:1,commits:[]};
   if(req.method()==='POST'&&!part.startsWith('/git/status-summary')){
    const body=req.postDataJSON();writes.push({part,...body});
    if(part==='/git/branch/delete'&&!body.force)return route.fulfill({status:400,json:{success:false,error:'Local branch is not fully merged. Force deletion requires explicit confirmation.'}});
    if(part==='/git/branch/delete-remote'){
     if(failRemote)return route.fulfill({status:400,json:{success:false,error:'The remote branch changed since the last Fetch. Fetch and review it before deleting.'}});
     if(waitForRemote)await new Promise(resolve=>{held=resolve});
    }
    branches=branches.filter(b=>b.name!==body.branch);
    data={message:'Deleted remote branch origin/old/topic. Local branches were kept.'};
   }
   await route.fulfill({json:{success:true,data}});
  });
  await page.goto(origin+'/r/fixture');
  const picker=page.getByTitle(/^Current branch: main/);
  const open=async()=>{await picker.click();await page.getByRole('button',{name:'Delete local branch old/topic',exact:true}).waitFor();};
  await open();assert(await page.getByRole('button',{name:'Delete local branch main',exact:true}).isDisabled());assert.equal(await page.getByRole('button',{name:'Delete remote branch origin/HEAD',exact:true}).count(),0);
  await page.getByRole('button',{name:'Delete local branch old/topic',exact:true}).click();await page.getByRole('heading',{name:'Delete local branch?',exact:true}).waitFor();assert.equal(writes.length,0);
  assert.equal(await page.getByRole('checkbox',{name:'Force delete, even with unmerged commits',exact:true}).isChecked(),false);
  await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(writes.length,0);
  await open();await page.getByRole('button',{name:'Delete local branch '+long,exact:true}).click();await page.getByRole('heading',{name:'Delete local branch?',exact:true}).waitFor();assert(await page.locator('.app-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth));await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await open();await page.getByRole('button',{name:'Delete local branch old/topic',exact:true}).click();await page.getByRole('button',{name:'Delete local branch',exact:true}).click();await page.getByText('Local branch is not fully merged. Force deletion requires explicit confirmation.',{exact:true}).waitFor();assert.equal(writes.length,1);assert.equal(writes[0].force,false);assert.equal(writes[0].expectedCommit,commit);
  await open();await page.getByRole('button',{name:'Delete local branch old/topic',exact:true}).click();await page.getByRole('checkbox',{name:'Force delete, even with unmerged commits',exact:true}).check();await page.getByRole('button',{name:'Delete local branch',exact:true}).click();await page.getByText('Deleted local branch old/topic',{exact:true}).waitFor();assert.equal(writes.at(-1).force,true);
  await picker.click();assert.equal(await page.getByRole('button',{name:'Delete local branch old/topic',exact:true}).count(),0);await page.getByRole('button',{name:'Delete remote branch origin/old/topic',exact:true}).click();await page.getByRole('heading',{name:'Delete remote branch?',exact:true}).waitFor();assert.equal(await page.getByRole('checkbox').count(),0);const before=writes.length;await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(writes.length,before);
  await picker.click();await page.getByRole('button',{name:'Delete remote branch origin/old/topic',exact:true}).click();await page.getByRole('button',{name:'Delete remote branch',exact:true}).click();await page.getByText('The remote branch changed since the last Fetch. Fetch and review it before deleting.',{exact:true}).waitFor();assert.equal(writes.at(-1).part,'/git/branch/delete-remote');assert.equal(writes.at(-1).force,undefined);
  failRemote=false;waitForRemote=true;await picker.click();await page.getByRole('button',{name:'Delete remote branch origin/old/topic',exact:true}).click();await page.getByRole('button',{name:'Delete remote branch',exact:true}).click();await page.waitForFunction(()=>document.querySelector('button[title^="Current branch:"]')?.disabled);assert(await picker.isDisabled());
  while(!held)await new Promise(r=>setTimeout(r,10));held();await page.getByText('Deleted remote branch origin/old/topic. Local branches were kept.',{exact:true}).waitFor();await picker.click();assert.equal(await page.getByRole('button',{name:'Delete remote branch origin/old/topic',exact:true}).count(),0);
  assert.equal(writes.length,4);assert(writes.every(w=>w.part==='/git/branch/delete'||w.part==='/git/branch/delete-remote'));assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
  console.log(`PASS ${width}px: local/remote trash, active/HEAD protections, cancel, explicit force, stale-remote error, busy state, refresh and long-name overflow`);
  await page.close();
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
