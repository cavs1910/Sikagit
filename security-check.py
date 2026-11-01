import base64,json,urllib.request,urllib.error,urllib.parse,subprocess
from pathlib import Path
BASE='http://127.0.0.1:18448'
AUTH='Basic '+base64.b64encode(b'audit:local-audit-only').decode()
REPO='/repos/repo'
def req(route,body=None,method=None,auth=True,origin=None):
    headers={'Authorization':AUTH} if auth else {}
    if origin:headers['Origin']=origin
    data=None
    if body is not None:data=json.dumps(body).encode();headers['Content-Type']='application/json'
    r=urllib.request.Request(BASE+'/api/v1/'+route,data=data,headers=headers,method=method)
    try:
        with urllib.request.urlopen(r,timeout=20) as x:return x.status,x.read(),dict(x.headers)
    except urllib.error.HTTPError as x:return x.code,x.read(),dict(x.headers)
def check(name,condition):
    assert condition,name
    print('PASS',name,flush=True)
def get(route,**q):return req(route+'?'+urllib.parse.urlencode({'repo':REPO,**q}))
check('API requires authentication',req('repos',auth=False)[0]==401)
check('foreign Origin denied',req('repos',origin='https://untrusted.invalid')[0]==403)
check('AI disabled',req('ai/suggest',{'repo':REPO,'apiKey':'unused','model':'unused'})[0]==403)
check('security headers',"script-src 'self'" in req('health')[2].get('Content-Security-Policy',''))
code,body,_=req('repos',{'path':REPO});check('register existing repository',code==201)
check('read git status',get('git/status')[0]==200)
check('read git history',get('git/log',limit=3)[0]==200)
check('read working diff',get('git/diff',file='tracked.txt')[0]==200)
check('traversal read rejected',get('git/file',file='../outside-secret.txt')[0]>=400)
check('symlink read rejected',get('git/file',file='escape')[0]>=400)
check('shell-injection revision rejected',get('git/commit-files',commit='HEAD;touch /tmp/sikagit-injected')[0]>=400)
check('shell-injection file/revision rejected',get('git/file',file='tracked.txt;touch /tmp/sikagit-injected',commit='HEAD')[0]>=400)
check('metadata access rejected',get('git/file',file='.git/config')[0]>=400)
check('traversal delete rejected',req('git/delete-untracked',{'repo':REPO,'files':['../outside-secret.txt']})[0]>=400)
check('outside file retained',Path('/tmp/sikagit-check/repos/outside-secret.txt').read_text()=='audit-marker\n')
check('outside repository rejected',req('repos',{'path':'/tmp'})[0]>=400)
check('validation never initializes repo',req('repos',{'path':'/repos/not-a-repo'})[0]>=400 and not Path('/tmp/sikagit-check/repos/not-a-repo/.git').exists())
check('credential configuration denied',req('git/config',{'repo':REPO,'key':'credential.helper','value':'!touch /tmp/sikagit-injected'})[0]>=400)
check('non-GitHub remote denied',req('git/remote-url',{'repo':REPO,'url':'ext::sh -c true'})[0]>=400)
files=['tracked.txt','new file;literal.txt']
check('stage files with literal shell metacharacters',req('git/stage',{'repo':REPO,'files':files})[0]==200)
check('unstage',req('git/unstage',{'repo':REPO,'files':['tracked.txt']})[0]==200)
check('restage',req('git/stage',{'repo':REPO,'files':['tracked.txt']})[0]==200)
message="Audit literal 'quoted' message; $(touch /tmp/sikagit-injected)"
check('commit with literal shell metacharacters',req('git/commit',{'repo':REPO,'message':message})[0]==200)
r=Path('/tmp/sikagit-check/repos/repo')
actual=subprocess.check_output(['git','-C',str(r),'log','-1','--format=%s'],text=True).strip()
check('commit message preserved literally',actual==message)
print('ALL CHECKS PASSED',flush=True)

# Socket.IO uses raw Node responses, not Express response helpers.
try:
    urllib.request.urlopen(BASE+'/socket.io/?EIO=4&transport=polling',timeout=5)
    raise AssertionError('Socket.IO accepted anonymous connection')
except urllib.error.HTTPError as e:
    check('Socket.IO rejects anonymous connection without crashing',e.code==401)
check('service survives rejected socket',req('health')[0]==200)

check('push to disposable local remote',req('git/push',{'repo':REPO,'setUpstream':True})[0]==200)
check('fetch disposable remote',req('git/fetch',{'repo':REPO})[0]==200)
check('pull disposable remote',req('git/pull',{'repo':REPO,'strategy':'merge'})[0]==200)
(r/'tracked.txt').write_text('unsaved audit work\n')
old=subprocess.check_output(['git','-C',str(r),'rev-parse','HEAD~1'],text=True).strip()
check('historical checkout refuses to destroy unsaved work',req('git/checkout',{'repo':REPO,'hash':old})[0]>=400 and (r/'tracked.txt').read_text()=='unsaved audit work\n')
print('FULL SECURITY AND GIT CHECKS PASSED',flush=True)
