import assert from 'node:assert/strict';
import test from 'node:test';
import { orderMediaByShotNumber, selectMediaForBeat } from '../src/utils/orderedMedia.ts';

test('uses the numbered Veo shot order, not arbitrary upload order', () => {
  const input = [
    { originalName: 'Scene 10.png', id: '10' },
    { originalName: 'Scene 2.png', id: '2' },
    { originalName: 'Scene 1.png', id: '1' },
  ];
  const ordered = orderMediaByShotNumber(input);
  assert.deepEqual(ordered.map((x) => x.id), ['1','2','10']);
  assert.deepEqual([0,1,2].map(i=>selectMediaForBeat(ordered,i,3).id),['1','2','10']);
});

test('preserves upload order if filenames are unnumbered or ambiguous', () => {
  const input = [
    { originalName: 'bird.png', id: 1 },
    { originalName: 'pot.png', id: 2 },
  ];
  assert.deepEqual(orderMediaByShotNumber(input), input);
});

test('distributes repeats when there are more cuts than assets', () => {
  const inputs=['a','b','c'];
  assert.deepEqual(Array.from({length:6},(_,i)=>selectMediaForBeat(inputs,i,6)),['a','a','b','b','c','c']);
});

test('does not reuse the very first media for the entire tail', () => {
  const inputs=Array.from({length:50},(_,i)=>i);
  const selected=Array.from({length:60},(_,i)=>selectMediaForBeat(inputs,i,60));
  assert.equal(selected[0],0);
  assert.equal(selected[59],49);
  assert.ok(new Set(selected).size===50);
});

test('rejects invalid empty assignments', () => {
  assert.throws(()=>selectMediaForBeat([],0,1));
  assert.throws(()=>selectMediaForBeat(['a'],2,1));
});
