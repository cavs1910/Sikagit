// Test-only transport adapter. The application validates a fixed fake GitHub
// URL first; only its push subprocess is redirected to a disposable bare repo.
// Never loaded or copied into the production application. Tests run --network none.
const cp=require('node:child_process');
const fs=require('node:fs');
const spawn=cp.spawn;
cp.spawn=function(command,args,options){
 const file=process.env.SIKAGIT_TEST_REMOTE_FIXTURE;
 if(file && fs.existsSync(file) && Array.isArray(args) && args.includes('push') && (command==='git'||command==='/usr/local/bin/git')){
  const fixture=JSON.parse(fs.readFileSync(file,'utf8'));
  if(args.includes(fixture.url)){
   fs.appendFileSync(fixture.log,JSON.stringify(args)+'\n');
   const mapped=args.map(arg=>arg===fixture.url?fixture.bare:arg);
   return spawn('/usr/bin/git',['-c','core.hooksPath=/dev/null','-c','protocol.ext.allow=never',...mapped],options);
  }
 }
 return spawn(command,args,options);
};
