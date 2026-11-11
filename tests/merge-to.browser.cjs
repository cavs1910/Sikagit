// Unified merge UI. All Git/API mutations are mocked; drag/drop only edits local selections.
const { chromium } = require(process.env.SIKAGIT_BROWSER_CLIENT || 'playwright');
const assert = require('node:assert/strict');
const origin = process.env.SIKAGIT_TEST_ORIGIN || 'http://127.0.0.1:5184';
(async () => {
 const browser = await chromium.launch();
 try { for (const width of [320, 390, 1280]) {
  const mobile=width<768;
  const page=await browser.newPage({viewport:{width,height:844},isMobile:mobile,hasTouch:mobile});page.setDefaultTimeout(10000);
  const a='a'.repeat(40),b='b'.repeat(40),c='c'.repeat(40),tips={feature:a,main:b,release:c};
  const names=['feature','main','release',...Array.from({length:35},(_,i)=>'topic/'+i)];for(const name of names)tips[name]||='d'.repeat(40);
  let current='feature',outcome='success',release,singleBranch=false;
  const writes=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('sikagit-ui',JSON.stringify({version:4,state:{autoFetchOnOpen:false}})));
  await page.route('**/socket.io/**',r=>r.abort());
  await page.route('**/api/v1/**',async route=>{
   const req=route.request(),part=new URL(req.url()).pathname.replace('/api/v1','');let data={};
   if(part==='/auth/session')data={authenticated:true,expiresAt:Date.now()+86400000};
   if(part==='/repos')data=[{id:'fixture',name:'Fixture repository',path:'/repos/fixture',displayPath:'/repos/fixture'}];
   if(part==='/projects'||part==='/git/tags')data=[];
   if(part==='/ai/settings')data={enabled:false,hasApiKey:false};
   if(part==='/git/status')data={current,tracking:null,hasRemote:false,ahead:0,behind:0,files:[],staged:[],unstaged:[],untracked:[],conflicted:[]};
   if(part==='/git/branches')data=names.filter(name=>tips[name]&&(!singleBranch||name===current)).map(name=>({name,current:name===current,isRemote:false,commit:tips[name]})).concat({name:'remotes/origin/main',current:false,isRemote:true,commit:b});
   if(part==='/git/graph')data={totalLanes:1,commits:[]};
   if(part==='/editor/tree')data=[{name:'fixture.txt',path:'fixture.txt',type:'file'}];
   if(req.method()==='POST'&&!part.startsWith('/git/status-summary')){
    const body=req.postDataJSON();writes.push({part,...body});
    if(part==='/git/merge-branches'){
     if(outcome==='held')await new Promise(resolve=>{release=resolve;});
     if(outcome==='error')return route.fulfill({status:400,json:{success:false,error:'The branch changed. Refresh the branch list and review it before merging.'}});
     current=body.targetBranch;
     if(outcome==='conflict')data={merged:false,message:'Merge conflict on '+current,conflicts:['shared.txt']};
     else{tips[current]=tips[body.sourceBranch];data={merged:true,message:'Merged '+body.sourceBranch+' into '+current};}
    }
    if(part==='/git/branch/delete')delete tips[body.branch];
   }
   await route.fulfill({json:{success:true,data}});
  });
  await page.goto(origin+'/r/fixture');await page.getByTitle(/^Current branch: feature/).waitFor();
  const picker=page.getByTitle(/^Current branch:/),dialog=page.getByRole('dialog',{name:'Merge branches',exact:true});
  const open=async()=>{await picker.click();await page.getByRole('button',{name:'Merge…',exact:true}).click();await dialog.waitFor();};
  const source=dialog.getByRole('combobox',{name:'Source branch',exact:true}),target=dialog.getByRole('combobox',{name:'Destination branch',exact:true});
  const swap=dialog.getByRole('button',{name:'Swap branches',exact:true}),ff=dialog.getByRole('switch',{name:'Allow fast-forward',exact:true}),deletion=dialog.getByRole('switch',{name:'Delete source branch after merge',exact:true});
  const preview=dialog.locator('.git-command-preview');
  const pair=async()=>[await source.inputValue(),await target.inputValue()];
  await picker.click();const footer=page.locator('.branch-menu-actions');
  assert.equal(await footer.getByRole('button',{name:'Merge…',exact:true}).count(),1);assert.equal(await page.getByRole('button',{name:/Merge To/}).count(),0);
  const mergeBox=await footer.getByRole('button',{name:'Merge…',exact:true}).boundingBox(),cleanupBox=await footer.getByRole('button',{name:'Clean up merged branches…',exact:true}).boundingBox();
  assert.equal(mergeBox.y,cleanupBox.y);assert((await footer.boundingBox()).height<50);assert(await page.getByLabel('Available branches').evaluate(e=>e.scrollHeight>e.clientHeight));await picker.click();
  await open();assert.deepEqual(await pair(),['feature','main']);assert.equal(await ff.getAttribute('aria-checked'),'true');assert.equal(await deletion.getAttribute('aria-checked'),'false');
  assert.equal(await source.locator('option[value^="remotes/"]').count(),0);assert.equal(await target.locator('option[value^="remotes/"]').count(),0);
  await ff.press('Space');await preview.locator('summary').press('Enter');await preview.getByText('git merge --no-ff refs/heads/feature',{exact:true}).waitFor();await preview.getByText('git switch --no-guess main',{exact:true}).waitFor();
  await deletion.click();await preview.getByText('git branch -d -- feature',{exact:true}).waitFor();await swap.click();assert.deepEqual(await pair(),['main','feature']);assert.equal(await deletion.getAttribute('aria-checked'),'false');assert.equal(await preview.locator('code').count(),1);await preview.getByText('git merge --no-ff refs/heads/main',{exact:true}).waitFor();
  await swap.press('Enter');assert.deepEqual(await pair(),['feature','main']);await source.selectOption('release');assert.deepEqual(await pair(),['release','main']);await target.selectOption('release');assert.deepEqual(await pair(),['main','release']);assert.equal(writes.length,0);
  await source.selectOption('feature');await target.selectOption('main');await preview.locator('summary').click();
  const drag=async(cancel=false)=>{
   const grip=dialog.getByRole('button',{name:'Drag source branch to swap',exact:true}),handle=await grip.boundingBox(),destination=await dialog.getByRole('group',{name:'Destination branch card',exact:true}).boundingBox();
   const x=handle.x+handle.width/2,y=handle.y+handle.height/2,endX=cancel?handle.x-100:destination.x+destination.width/2,endY=destination.y+destination.height/2;
   if(mobile){
    const session=await page.context().newCDPSession(page);
    await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
    for(let i=1;i<=8;i++)await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+(endX-x)*i/8,y:y+(endY-y)*i/8}]});
    await session.send('Input.dispatchTouchEvent',{type:cancel?'touchCancel':'touchEnd',touchPoints:[]});await session.detach();
   }else{
    await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(endX,endY,{steps:12});await page.mouse.up();
   }
  };
  await drag();assert.deepEqual(await pair(),['main','feature']);assert.equal(writes.length,0);
  await drag(true);assert.deepEqual(await pair(),['main','feature']);assert.equal(writes.length,0);
  await dialog.getByRole('button',{name:'Drag source branch to swap',exact:true}).press('ArrowDown');assert.deepEqual(await pair(),['feature','main']);
  await dialog.getByRole('button',{name:'Drag destination branch to swap',exact:true}).press('ArrowUp');assert.deepEqual(await pair(),['main','feature']);await swap.click();
  await ff.click();
  if(process.env.SIKAGIT_MERGE_PREVIEW_DIR){await page.screenshot({animations:'disabled',path:process.env.SIKAGIT_MERGE_PREVIEW_DIR+'/unified-merge-'+width+'.png'});await preview.locator('summary').click();await deletion.click();await page.screenshot({animations:'disabled',path:process.env.SIKAGIT_MERGE_PREVIEW_DIR+'/unified-commands-'+width+'.png'});await deletion.click();await preview.locator('summary').click();}
  await page.setViewportSize({width,height:350});await page.waitForFunction(()=>{const box=document.querySelector('[aria-label="Merge branches"]').getBoundingClientRect();return box.y>=0&&box.bottom<=innerHeight;});assert(await dialog.getByRole('button',{name:'Merge',exact:true}).isVisible());assert(await dialog.locator('.overflow-y-auto').first().evaluate(e=>e.scrollHeight>e.clientHeight));
  await page.setViewportSize({width,height:844});await page.waitForFunction(()=>document.querySelector('.app-shell').getBoundingClientRect().height>=844);await dialog.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(writes.length,0);
  await open();outcome='held';await dialog.getByRole('button',{name:'Merge',exact:true}).click();await dialog.getByRole('button',{name:'Merging...',exact:true}).waitFor();assert(await source.isDisabled());assert(await target.isDisabled());assert(await swap.isDisabled());assert(await ff.isDisabled());assert(await deletion.isDisabled());assert(await dialog.getByRole('button',{name:'Close merge dialog',exact:true}).isDisabled());
  assert.deepEqual(writes[0],{part:'/git/merge-branches',repo:'/repos/fixture',sourceBranch:'feature',targetBranch:'main',expectedBranch:'feature',expectedSourceCommit:a,expectedTargetCommit:b,fastForward:true});
  outcome='success';release();await dialog.waitFor({state:'hidden'});await page.getByTitle(/^Current branch: main/).waitFor();
  // Any pair is allowed, even when neither branch is the active one.
  await open();await source.selectOption('feature');await target.selectOption('release');await dialog.getByRole('button',{name:'Merge',exact:true}).click();await dialog.waitFor({state:'hidden'});assert.equal(writes.at(-1).expectedBranch,'main');assert.equal(writes.at(-1).targetBranch,'release');await page.getByTitle(/^Current branch: release/).waitFor();
  // A current destination omits the switch and still binds both reviewed tips.
  await open();await source.selectOption('feature');await target.selectOption('release');await preview.locator('summary').click();await preview.getByText('git merge --ff refs/heads/feature',{exact:true}).waitFor();assert.equal(await preview.locator('code').count(),1);await dialog.getByRole('button',{name:'Merge',exact:true}).click();await dialog.waitFor({state:'hidden'});
  outcome='conflict';await open();await source.selectOption('feature');await target.selectOption('main');await deletion.click();await preview.locator('summary').click();await dialog.getByRole('button',{name:'Merge',exact:true}).click();await dialog.getByText('shared.txt',{exact:true}).waitFor();await preview.getByText('git merge --abort',{exact:true}).waitFor();assert(await swap.isDisabled());assert(await source.isDisabled());assert.equal(writes.filter(w=>w.part==='/git/branch/delete').length,0);
  await dialog.getByRole('button',{name:'Abort Merge',exact:true}).click();await dialog.waitFor({state:'hidden'});assert.equal(writes.at(-1).part,'/git/merge/abort');await page.getByTitle(/^Current branch: main/).waitFor();
  outcome='error';await open();await dialog.getByRole('button',{name:'Merge',exact:true}).click();await dialog.getByRole('alert').waitFor();await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  outcome='success';await open();await source.selectOption('feature');await target.selectOption('main');await ff.click();await deletion.click();await dialog.getByRole('button',{name:'Merge',exact:true}).click();await dialog.waitFor({state:'hidden'});assert.deepEqual(writes.slice(-2).map(w=>w.part),['/git/merge-branches','/git/branch/delete']);assert.equal(writes.at(-2).fastForward,false);assert.deepEqual(writes.at(-1),{part:'/git/branch/delete',repo:'/repos/fixture',branch:'feature',force:false,expectedCommit:a});
  assert(!writes.some(w=>w.part.includes('push')||w.part==='/git/switch-branch'||w.part==='/git/merge-to'||w.part==='/git/merge'));
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
  singleBranch=true;await page.reload();await page.getByTitle(/^Current branch: main/).click();assert(await page.getByRole('button',{name:'Merge…',exact:true}).isDisabled());
  console.log(`PASS ${width}px: single merge entry, arbitrary pairs, mouse/touch drag, cancelled drag, keyboard swap, command preview, bound request, busy guards, deletion, conflict/abort and short viewport`);
  await page.close();
 }} finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
