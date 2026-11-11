// All API and Git writes are mocked; no real repositories or AI calls.
const { chromium } = require(process.env.SIKAGIT_BROWSER_CLIENT || 'playwright');
const assert = require('node:assert/strict');
const origin = process.env.SIKAGIT_TEST_ORIGIN || 'http://127.0.0.1:5184';
(async () => {
 const browser = await chromium.launch();
 try { for (const width of [320, 390, 1280]) {
  const page = await browser.newPage({viewport:{width,height:844}});
  page.setDefaultTimeout(10000);
  let current='feature', outcome='success', release;
  const writes=[],errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('sikagit-ui',JSON.stringify({version:4,state:{autoFetchOnOpen:false}})));
  await page.route('**/socket.io/**',r=>r.abort());
  await page.route('**/api/v1/**',async route=>{
   const req=route.request(),part=new URL(req.url()).pathname.replace('/api/v1','');
   let data={};
   if(part==='/auth/session')data={authenticated:true,expiresAt:Date.now()+86400000};
   if(part==='/repos')data=[{id:'fixture',name:'Fixture repository',path:'/repos/fixture',displayPath:'/repos/fixture'}];
   if(part==='/projects'||part==='/git/tags')data=[];
   if(part==='/ai/settings')data={enabled:false,hasApiKey:false};
   if(part==='/git/status')data={current,tracking:null,hasRemote:false,ahead:0,behind:0,files:[],staged:[],unstaged:[],untracked:[],conflicted:[]};
   if(part==='/git/branches')data=['feature','main','release',...Array.from({length:35},(_,i)=>'topic/'+i)].map(name=>({name,current:name===current,isRemote:false,commit:'a'.repeat(40)})).concat({name:'remotes/origin/main',current:false,isRemote:true,commit:'b'.repeat(40)});
   if(part==='/git/graph')data={totalLanes:1,commits:[]};
   if(part==='/editor/tree')data=[{name:'fixture.txt',path:'fixture.txt',type:'file'}];
   if(req.method()==='POST' && !part.startsWith('/git/status-summary')){
    const body=req.postDataJSON();writes.push({part,...body});
    if(part==='/git/merge-to'){
     if(outcome==='held')await new Promise(resolve=>{release=resolve;});
     if(outcome==='error')return route.fulfill({status:400,json:{success:false,error:'Commit or stash local changes before using Merge To.'}});
     current=body.targetBranch;
     data=outcome==='conflict'?{merged:false,message:'Merge conflict on '+current,conflicts:['shared.txt']}:{merged:true,message:'Merged '+body.sourceBranch+' into '+current};
    }
    if(part==='/git/merge')data={merged:true,message:'Merged'};
   }
   await route.fulfill({json:{success:true,data}});
  });
  await page.goto(origin+'/r/fixture');
  const picker=page.getByRole('button',{name:/feature/}).filter({has:page.locator('svg.lucide-git-branch')});
  await picker.waitFor();
  const open=async mode=>{await page.getByTitle(/^Current branch:/).click();await page.getByRole('button',{name:mode==='to'?'Merge To…':'Merge…',exact:true}).click();};
  const dialog=page.locator('.app-dialog');
  await page.getByTitle(/^Current branch:/).click();
  const footer=page.locator('.branch-menu-actions'),menu=page.locator('.branch-menu');
  const fromBox=await footer.getByRole('button',{name:'Merge…',exact:true}).boundingBox(),toBox=await footer.getByRole('button',{name:'Merge To…',exact:true}).boundingBox();
  assert.equal(fromBox.y,toBox.y);assert((await footer.boundingBox()).height<50,JSON.stringify(await footer.evaluate(el=>({height:el.clientHeight,width:el.clientWidth,cols:getComputedStyle(el).gridTemplateColumns,buttons:[...el.querySelectorAll('button')].map(b=>({text:b.innerText,width:b.clientWidth,height:b.clientHeight}))}))));assert.equal((await footer.getByRole('button',{name:'Clean up merged branches…',exact:true}).boundingBox()).y,fromBox.y);
  assert(await page.getByLabel('Available branches').evaluate(el=>el.scrollHeight>el.clientHeight));
  assert((await menu.boundingBox()).y+(await menu.boundingBox()).height<=844);
  if(process.env.SIKAGIT_MERGE_PREVIEW_DIR)await page.screenshot({path:process.env.SIKAGIT_MERGE_PREVIEW_DIR+'/branch-picker-'+width+'.png'});
  await page.getByTitle(/^Current branch:/).click();
  await open('from');
  const ff=page.getByRole('switch',{name:'Allow fast-forward',exact:true}),deletion=page.getByRole('switch',{name:'Delete source branch after merge',exact:true});
  assert.equal(await ff.getAttribute('aria-checked'),'true');await ff.focus();await page.keyboard.press('Space');assert.equal(await ff.getAttribute('aria-checked'),'false');
  assert(await page.getByRole('button',{name:'Source branch',exact:true}).isVisible());await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(writes.length,0);
  await open('to');assert.equal(await ff.getAttribute('aria-checked'),'true');assert.equal(await deletion.getAttribute('aria-checked'),'false');
  await page.setViewportSize({width,height:350});
  await page.waitForFunction(()=>{const box=document.querySelector('.app-dialog').getBoundingClientRect();return box.y>=0&&box.bottom<=innerHeight;});
  const small=await dialog.boundingBox();assert(small.y>=0&&small.y+small.height<=350);assert(await dialog.getByRole('button',{name:'Merge To',exact:true}).isVisible());assert(await dialog.locator('.overflow-y-auto').first().evaluate(el=>el.scrollHeight>el.clientHeight));
  await page.setViewportSize({width,height:844});await page.waitForFunction(()=>document.querySelector('.app-shell').getBoundingClientRect().height>=844);
  if(process.env.SIKAGIT_MERGE_PREVIEW_DIR)await page.screenshot({path:process.env.SIKAGIT_MERGE_PREVIEW_DIR+'/merge-dialog-'+width+'.png'});
  assert.equal(await page.getByRole('button',{name:'Destination branch',exact:true}).innerText(),'main');
  await page.getByRole('button',{name:'Destination branch',exact:true}).click();assert.equal(await dialog.getByRole('button',{name:'feature',exact:true}).count(),0);assert.equal(await dialog.getByRole('button',{name:'remotes/origin/main',exact:true}).count(),0);
  await dialog.getByRole('button',{name:'release',exact:true}).click();assert.equal(writes.length,0);
  assert(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth));await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(writes.length,0);
  await open('to');outcome='held';await page.getByRole('button',{name:'Merge To',exact:true}).click();
  await page.getByRole('button',{name:'Merging...',exact:true}).waitFor();assert(await page.getByRole('button',{name:'Close merge dialog',exact:true}).isDisabled());assert(await page.getByRole('button',{name:'Destination branch',exact:true}).isDisabled());
  assert(await ff.isDisabled());assert(await deletion.isDisabled());
  assert.equal(writes.length,1);assert.deepEqual(writes[0],{part:'/git/merge-to',repo:'/repos/fixture',sourceBranch:'feature',targetBranch:'main',fastForward:true});
  outcome='success';release();await dialog.waitFor({state:'hidden'});await page.getByTitle(/^Current branch: main/).waitFor();
  // Current main -> feature, with opt-in source deletion after success.
  await open('to');await deletion.click();await ff.click();await page.getByRole('button',{name:'Merge To',exact:true}).click();await dialog.waitFor({state:'hidden'});
  assert.deepEqual(writes.slice(-2).map(w=>w.part),['/git/merge-to','/git/branch/delete']);assert.equal(writes.at(-1).branch,'main');assert.equal(writes.at(-2).fastForward,false);
  await page.getByTitle(/^Current branch: feature/).waitFor();outcome='conflict';await open('to');await page.getByRole('button',{name:'Merge To',exact:true}).click();
  await page.getByText('shared.txt',{exact:true}).waitFor();await page.getByTitle(/^Current branch: main/).waitFor();assert(await page.getByRole('button',{name:'Destination branch',exact:true}).isDisabled());
  await page.getByRole('button',{name:'Abort Merge',exact:true}).click();await dialog.waitFor({state:'hidden'});assert.equal(writes.at(-1).part,'/git/merge/abort');await page.getByTitle(/^Current branch: main/).waitFor();
  outcome='error';await open('to');await page.getByRole('button',{name:'Merge To',exact:true}).click();await page.getByText('Commit or stash local changes before using Merge To.',{exact:true}).waitFor();await page.getByRole('button',{name:'Cancel',exact:true}).click();
  outcome='success';await open('from');await ff.click();await page.getByRole('button',{name:'Merge',exact:true}).click();await dialog.waitFor({state:'hidden'});assert.equal(writes.at(-1).part,'/git/merge');assert.equal(writes.at(-1).fastForward,false);
  assert(!writes.some(w=>w.part.includes('push')||w.part==='/git/switch-branch'));
  // Also exercise the previously added Explorer divider with the same fixtures.
  await page.getByRole('tab',{name:'Files',exact:true}).click();await page.getByText('EXPLORER',{exact:true}).waitFor();
  const explorer=page.locator('aside').filter({has:page.getByText('EXPLORER',{exact:true})});
  if(width>=768){
   const divider=explorer.locator('xpath=following-sibling::*[1]'),box=await divider.boundingBox();
   await page.mouse.move(box.x+2,box.y+40);await page.mouse.down();await page.mouse.move(box.x+182,box.y+40,{steps:12});await page.mouse.up();assert.equal((await explorer.boundingBox()).width,404);
  }else assert.equal((await explorer.boundingBox()).width,width);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
  console.log(`PASS ${width}px: Merge / Merge To, compact footer, FF switches, keyboard, destinations, short viewport, busy state, source deletion, conflicts, abort and Explorer`);
  await page.close();
 }} finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
