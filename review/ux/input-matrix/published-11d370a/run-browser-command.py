import argparse,os,json,subprocess,hashlib,datetime
from pathlib import Path
a=argparse.ArgumentParser();a.add_argument('--harness',required=True);a.add_argument('--repository',required=True);a.add_argument('--output',required=True);a.add_argument('--scenario');a.add_argument('--capture',default='none');p=a.parse_args()
w=Path(p.repository).resolve();h=Path(p.harness).resolve();o=Path(p.output).resolve();o.mkdir(parents=True,exist_ok=False)
node='/workspace/scratch/41d02a12a55b/task-state/toolchains/node24/node_modules/node/bin/node'
env=os.environ.copy();env['LANDING_PLAYWRIGHT_MODULE']='/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';env['LANDING_CHROMIUM_EXECUTABLE']='/workspace/scratch/f79c57b98c5b/browser-runtime/chromium'
cmd=[node,str(h/'scripts/check-scroll-browser.mjs'),'--repository',str(w),'--output',str(o/'observations'),'--capture',p.capture]
if p.scenario:cmd+=['--scenario',p.scenario]
now=lambda:datetime.datetime.now(datetime.timezone.utc).isoformat()
git=lambda *args:subprocess.check_output(['git',*args],cwd=w,text=True).strip()
r={'schema':'ticketstub.browser-command/1','revision':git('rev-parse','HEAD'),'command':cmd,'cwd':str(h),'node':subprocess.check_output([node,'--version'],text=True).strip(),'mode':'local-browser-emulated-input','startedAt':now(),'result':'RUNNING','environment':{'playwrightModule':env['LANDING_PLAYWRIGHT_MODULE'],'chromiumExecutable':env['LANDING_CHROMIUM_EXECUTABLE'],'transport':'existing-environment-proxy' if env.get('HTTPS_PROXY') or env.get('HTTP_PROXY') else 'direct','additionalCATrust':'present-public-key-pins-only' if env.get('NODE_EXTRA_CA_CERTS') else 'absent','fontconfigFileOverride':'inherited-present' if env.get('FONTCONFIG_FILE') else 'absent','libraryPathOverride':'inherited-present' if env.get('LD_LIBRARY_PATH') else 'absent'}}
(o/'command.json').write_text(json.dumps(r,indent=2)+'\n')
print(json.dumps({'startedAt':r['startedAt'],'sourceRevision':r['revision'],'output':str(o)}),flush=True)
with (o/'stdout.log').open('w') as out,(o/'stderr.log').open('w') as err:
 result=subprocess.run(cmd,cwd=h,env=env,stdout=out,stderr=err)
r.update({'completedAt':now(),'exitCode':result.returncode,'result':'PASS' if result.returncode==0 else 'FAIL','streams':{n:{'sha256':hashlib.sha256((o/n).read_bytes()).hexdigest(),'bytes':(o/n).stat().st_size} for n in ['stdout.log','stderr.log']}})
(o/'command.json').write_text(json.dumps(r,indent=2)+'\n')
print(json.dumps({'completedAt':r['completedAt'],'exitCode':result.returncode,'output':str(o)}),flush=True)
raise SystemExit(result.returncode)
