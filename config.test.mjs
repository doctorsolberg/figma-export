import {test} from 'node:test';
import assert from 'node:assert/strict';
import {options} from './config.mjs';

const team=['--team','Example=123'];

test('CLI can extend the wait for large Figma exports',()=>{
  assert.equal(options(team).downloadTimeout,20*60_000);
  const config=options([...team,'--export-timeout-minutes','45']);
  assert.equal(config.downloadTimeout,45*60_000);
});

test('CLI rejects invalid export timeouts',()=>{
  for(const value of ['0','-1','1.5','1e2',' 45','121','']){
    assert.throws(()=>options([...team,`--export-timeout-minutes=${value}`]),/whole number from 1 to 120/);
  }
});
