// Mock every API response. Never call AI or modify a real repository.
const {chromium}=require(process.env.SIKAGIT_BROWSER_CLIENT||'playwright');
const assert=require('node:assert/strict');
const origin=process.env.SIKAGIT_TEST_ORIGIN||'http://127.0.0.1:5184';
(async()=>{
 const browser=await chromium.launch();
 try{for(const width of [390,1280]){
  const page=await browser.newPage({viewport:{width,height:844}});page.setDefaultTimeout(10000);
  let previews=0,tests=0,executes=0,saves=0;
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  let settings={enabled:true,provider:'vercel',model:'alibaba/fixture',gatewayMode:'managed',byokProvider:'openai',hasApiKey:true,hasByokKey:false,revision:'fixture',connections:{},language:'auto',conventionalCommits:true,maxDiffChars:30000,maxOutputTokens:2048,responseMode:'structured'};
  await page.addInitScript(()=>localStorage.setItem('sikagit-ui',JSON.stringify({version:4,state:{autoFetchOnOpen:false,backgroundSmartCommit:false}})));
  await page.route('**/socket.io/**',r=>r.abort());
  await page.route('**/api/v1/**',async route=>{
   const req=route.request(),part=new URL(req.url()).pathname.replace('/api/v1','');let data={};
   if(part==='/auth/session')data={authenticated:true,expiresAt:Date.now()+86400000};
   if(part==='/repos')data=[{id:'fixture',name:'Fixture repository',path:'/repos/fixture',displayPath:'/repos/fixture'}];
   if(part==='/projects'||part==='/git/tags')data=[];
   if(part==='/git/status'){const staged=[{path:'fixture.txt',index:'M',workingDir:' ',isStaged:true}];data={current:'main',tracking:null,hasRemote:false,ahead:0,behind:0,files:staged,staged,unstaged:[],untracked:[],conflicted:[]};}
   if(part==='/git/branches')data=[{name:'main',current:true,isRemote:false,commit:'a'.repeat(40)}];
   if(part==='/git/graph')data={totalLanes:1,commits:[]};
   if(part==='/ai/settings'){
    if(req.method()==='PUT'){saves++;settings={...settings,...req.postDataJSON()};}
    data=settings;
   }
   if(part==='/ai/models')data={provider:'vercel',models:[],sourceName:'Fixture',sourceURL:'https://example.invalid',sourceType:'snapshot',updatedAt:'2026-11-05',stale:false};
   if(part==='/ai/test')tests++;
   if(part==='/ai/smart-commit/execute')executes++;
   if(part==='/ai/smart-commit/preview'){
    previews++;
    if(previews<=2){
     const error=previews===1?'The model reached the 2048-token output limit before completing the response. Increase Maximum output tokens in Settings → AI.':'The model response did not match the required commit format. Invalid field: groups[0].title. Maximum: 72.';
     return route.fulfill({status:400,json:{success:false,error,aiError:{code:previews===1?'output_limit':'invalid_response',requestId:'00000000-0000-0000-0000-000000000001',provider:'vercel',model:'alibaba/fixture',responseMode:'structured',maxOutputTokens:settings.maxOutputTokens,finishReason:previews===1?'length':'stop',outputTokens:2048,reasoningTokens:2000}}});
    }
    data={planId:'fixture-plan',groups:[{title:'fix: fixture',description:'Fixture description',files:['fixture.txt']}]};
   }
   await route.fulfill({json:{success:true,data}});
  });
  await page.goto(origin+'/r/fixture');
  if(width<768)await page.getByRole('button',{name:'Changes',exact:true}).click();
  await page.getByRole('button',{name:'Smart Commit',exact:true}).click();
  await page.getByText(/The model reached the 2048-token/).waitFor();assert.equal(previews,1);
  const dialog=page.locator('.app-dialog');assert(await dialog.getByText(/No commits were created/).isVisible());assert(await dialog.getByText(/Vercel AI Gateway · alibaba\/fixture/).isVisible());assert(await dialog.getByText(/2000 reasoning/).isVisible());assert(await dialog.getByText('00000000-0000-0000-0000-000000000001',{exact:true}).isVisible());
  assert(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth));
  await page.getByRole('button',{name:'AI settings',exact:true}).click();await page.getByRole('heading',{name:'AI Assistant',exact:true}).waitFor();assert.equal(previews,1);assert.equal(tests,0);
  const settingsDialog=page.locator('.app-dialog').last();
  const conventional=settingsDialog.getByRole('switch',{name:'Conventional commit titles',exact:true});
  await conventional.press('Space');assert.equal(await conventional.getAttribute('aria-checked'),'false');await conventional.press('Space');
  const background=settingsDialog.getByRole('switch',{name:'Background Smart Commit',exact:true}),push=settingsDialog.getByRole('switch',{name:'Also push after background commits',exact:true});
  assert(await push.isDisabled());await background.click();assert(await push.isEnabled());await background.click();assert(await push.isDisabled());
  await settingsDialog.getByText('Advanced limits',{exact:false}).click();
  await settingsDialog.getByRole('spinbutton',{name:'Maximum output tokens',exact:true}).fill('4096');
  await settingsDialog.getByRole('button',{name:'Save AI configuration',exact:true}).click();await settingsDialog.getByText('Configuration saved on the server.',{exact:true}).waitFor();assert.equal(saves,1);assert.equal(previews,1);assert.equal(tests,0);
  await settingsDialog.getByRole('button',{name:'General',exact:true}).click();
  for(const name of ['Group Files by Folder','Auto-fetch on Open','Demo / Privacy Mode']){
   const option=settingsDialog.getByRole('switch',{name,exact:true}),before=await option.getAttribute('aria-checked');
   await option.press('Enter');assert.notEqual(await option.getAttribute('aria-checked'),before);await option.press('Enter');assert.equal(await option.getAttribute('aria-checked'),before);
  }
  // The settings close button contains X; the draft settings are already saved.
  await settingsDialog.locator('button').filter({has:page.locator('svg.lucide-x')}).click();
  await page.getByRole('button',{name:'Retry analysis',exact:true}).click();await page.getByText(/Invalid field: groups\[0\].title/).waitFor();assert.equal(previews,2);
  await page.getByRole('button',{name:'Retry analysis',exact:true}).click();await page.getByText('fix: fixture',{exact:true}).waitFor();assert.equal(previews,3);assert.equal(executes,0);assert.equal(tests,0);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
  console.log(`PASS ${width}px: specific AI errors, metadata, settings shortcut/save, explicit retries, recovery and no commits or connection-test calls`);
  await page.close();
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
