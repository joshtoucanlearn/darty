import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const html=fs.readFileSync(new URL('../match-engine/match.html',import.meta.url),'utf8');
const accepted={
  "performFakeShot": "13c228246efb5183288b238f3bc8ef2b36ecff5ba939467e137786add9102549",
  "primeSkillUtility": "b1b86cdffd61e1b189ac523a892574f74369f1c388d72cb78ebae420c9f8a9d8",
  "skillTackleModifier": "4cad18d49049e6be580987a8b61491b73c446dbeb16d9f3055e770d4db9254bd",
  "updateActiveSkill": "0dfca7a09942a97dc80a15df15942ae97df168c168b8faf6881cab372d67e298"
};
test('CPU fake-shot delegation leaves every accepted human fake/utility/active-skill function byte-identical',()=>{
 for(const [name,sha]of Object.entries(accepted)){const a=html.indexOf('  function '+name+'('),b=html.indexOf('\n  function ',a+3);
  assert.ok(a>=0&&b>a);assert.equal(createHash('sha256').update(html.slice(a,b)).digest('hex'),sha,name);}
 assert.ok(html.includes('performFakeShot(actor,state,true)'));
});
