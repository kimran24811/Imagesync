import assert from 'node:assert/strict';
import test from 'node:test';
import { matchCaptionsToScriptBeats, visualTokens } from '../src/utils/semanticMatching.ts';

test('understands simple crow/pebble/jar synonyms from image descriptions', () => {
  const captions = [
    {id:'pot',description:'A raven perched on a round clay jar peering down into low water'},
    {id:'flying',description:'A black bird flying under a blazing sun over parched land'},
    {id:'pebbles',description:'A crow dropping small rounded pebbles into a pitcher of water'},
    {id:'drink',description:'A bird sipping water from the jar, relieved and happy'},
  ];
  const beats = [
    'The thirsty crow flew across the hot land',
    'He spotted a clay pot with water inside',
    'He dropped small stones inside the pot',
    'The crow could finally drink water',
  ];
  const result = matchCaptionsToScriptBeats(beats,captions);
  assert.deepEqual(result.map((x)=>x.id),['flying','pot','pebbles','drink']);
});

test('works without meaningful filenames and does not require numbering', () => {
  const captions=[
    {id:'randomfile_a',description:'A black crow standing on a branch in an empty dry desert'},
    {id:'randomfile_z',description:'A crow dropping pebbles into a terracotta pot'},
  ];
  const result=matchCaptionsToScriptBeats(['Crow picked up stones and dropped them into a clay pot'],captions);
  assert.equal(result[0].id,'randomfile_z');
});

test('repeating identical inputs does not trigger fake confidence', () => {
  const captions=[{id:'a',description:'A bright blue square'},{id:'b',description:'An orange cloud'}];
  const result=matchCaptionsToScriptBeats(['Crow drinks water'],captions);
  assert.equal(result[0].confidence,'low');
});

test('empty descriptions and absent media are rejected', () => {
  assert.throws(()=>matchCaptionsToScriptBeats(['crow flies'],[]));
  assert.deepEqual(matchCaptionsToScriptBeats([],[{id:'x',description:'bird'}]),[]);
  assert.ok(visualTokens('Raven flies with pebbles').includes('crow'));
});
