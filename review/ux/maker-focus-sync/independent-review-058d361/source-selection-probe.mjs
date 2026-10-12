import assert from 'node:assert/strict';
import { mkdtemp, cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { buildSite } from '/workspace/scratch/f79c57b98c5b/maker-focus-independent-review/scripts/build.mjs';
import run from '/workspace/scratch/f79c57b98c5b/maker-focus-independent-review/scripts/suites/ux.mjs';
const source='/workspace/scratch/f79c57b98c5b/maker-focus-independent-review';
const repository=await mkdtemp(resolve(tmpdir(),'lp-independent-source-selection-'));
const result={runtime:process.version,mode:'synthetic changed-source artifact and actual UX dispatcher, with/without explicit old-control HTML override',rows:[]};
try {
 await cp(resolve(source,'site'),resolve(repository,'site'),{recursive:true});
 await mkdir(resolve(repository,'tests'));
 for(const file of ['scroll.test.mjs','maker-focus.test.mjs'])await cp(resolve(source,'tests',file),resolve(repository,'tests',file));
 const original=await readFile(resolve(repository,'site/index.html'),'utf8');
 const needle="addEventListener('scroll', syncBoardState, { passive: true });";
 assert.equal(original.split(needle).length,2);
 const broken=original.replace(needle,'// Synthetic regression: native board scroll synchronization removed.');
 await writeFile(resolve(repository,'site/index.html'),broken);
 result.cleanSourceSha256=createHash('sha256').update(original).digest('hex');
 result.brokenSourceSha256=createHash('sha256').update(broken).digest('hex');
 for(const override of [false,true]){
  if(override)process.env.MAKER_FOCUS_TEST_HTML=resolve(source,'site/index.html');else delete process.env.MAKER_FOCUS_TEST_HTML;
  const {output}=await buildSite({repository});
  let returned=null,error=null;try{returned=await run({root:repository,artifactDir:output,mode:'draft'});}catch(e){error=e.message;}
  result.rows.push({override,overrideSource:override?resolve(source,'site/index.html'):null,returned,error});
 }
 assert.ok(result.rows[0].error,'Default validation must reject the actual broken native board source');
 assert.equal(result.rows[1].returned?.status,'PASS_DRAFT','Current dispatcher is retargeted by ambient baseline-control override');
 console.log('INDEPENDENT_SOURCE_SELECTION_RESULT '+JSON.stringify(result));
 await writeFile('/workspace/scratch/f79c57b98c5b/maker-focus-independent-evidence/source-selection-results.json',JSON.stringify(result,null,2)+'\n');
}finally{delete process.env.MAKER_FOCUS_TEST_HTML;await rm(repository,{recursive:true,force:true});}
