// Only loaded by the isolated test child, never by the production server.
const fs=require('node:fs');
const original=global.fetch;
global.fetch=async(url,init)=>{
 if(String(url)==='https://models.dev/api.json'||String(url)==='https://openrouter.ai/api/v1/models'||String(url)==='https://ai-gateway.vercel.sh/v1/models') {
  const fixture=JSON.parse(fs.readFileSync(process.env.AI_TEST_FIXTURE,'utf8'));
  const headers=new Headers(init?.headers);
  fs.appendFileSync(process.env.AI_TEST_CATALOG_LOG,JSON.stringify({url:String(url),hasAuthorization:headers.has('authorization'),redirect:init?.redirect,userAgent:headers.get('user-agent')})+'\n');
  if(fixture.catalogOffline)throw new Error('simulated catalog outage');
  return new Response(JSON.stringify(fixture.catalog),{headers:{'content-type':'application/json'}});
 }

 if(String(url)==='https://ai-gateway.vercel.sh/v4/ai/language-model') {
  const fixture=JSON.parse(fs.readFileSync(process.env.AI_TEST_FIXTURE,'utf8'));
  fs.appendFileSync(process.env.AI_TEST_GATEWAY_LOG,JSON.stringify({url:String(url),headers:Object.fromEntries(new Headers(init?.headers)),body:JSON.parse(init.body),redirect:init.redirect})+'\n');
  if(fixture.status) return new Response(JSON.stringify({error:{message:'secret-provider-error-'+fixture.secret}}),{status:fixture.status,headers:{'content-type':'application/json'}});
  return new Response(JSON.stringify({content:[{type:'text',text:JSON.stringify(fixture.output)}],finishReason:{unified:'stop',raw:'stop'},usage:{inputTokens:{total:1,noCache:1},outputTokens:{total:1,text:1}},warnings:fixture.warnings||[]}),{headers:{'content-type':'application/json'}});
 }
 if(!String(url).startsWith('https://api.openai.com/')&&!String(url).startsWith('https://openrouter.ai/')) return original(url,init);
 const fixture=JSON.parse(fs.readFileSync(process.env.AI_TEST_FIXTURE,'utf8'));
 if(fixture.status) return new Response(JSON.stringify({error:{message:'secret-provider-error-'+fixture.secret}}),{status:fixture.status,headers:{'content-type':'application/json'}});
 return new Response(JSON.stringify({id:'chatcmpl-test',object:'chat.completion',created:1,model:'test-model',choices:[{index:0,message:{role:'assistant',content:JSON.stringify(fixture.output)},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}),{headers:{'content-type':'application/json'}});
};
