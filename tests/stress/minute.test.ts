import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fixture, COLORS } from '../integration/fixtures.ts';
import { renderProjectMp4 } from '../../server/services/videoRenderer.ts';
import { runCommandBuffer } from '../../server/services/execUtils.ts';
import { validateRenderedMp4 } from '../../server/services/renderValidation.ts';

test('one-minute 1080x1920 reel: 110 unordered uploads, 50 assigned shots, captions, transitions and SFX', { timeout: 900_000 }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'SceneSync 60s '));
  try {
    const input = await fixture(dir, 110, 60_000);
    const originals = input.scenes;
    input.scenes = Array.from({ length: 50 }, (_, i) => ({ ...originals[(i * 17) % 110],
      id: `selected_${i}`, index: i, startMs: i * 1200, endMs: (i + 1) * 1200,
      durationMs: 1200, text: `Known visual ${i + 1}`, }));
    assert.equal(input.mediaById.size, 110);
    const file = await renderProjectMp4(input);
    await validateRenderedMp4(file, 60_000, 1800, 1080, 1920);
    const pixels = await runCommandBuffer('ffmpeg', ['-v', 'error', '-i', file, '-vf',
      `select='${input.scenes.map((_, i) => `eq(n,${i * 36 + 18})`).join('+')}',scale=54:96`,
      '-fps_mode', 'vfr', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1']);
    assert.equal(pixels.length, 50 * 54 * 96 * 3);
    for (let i = 0; i < 50; i++) {
      const off = i * 54 * 96 * 3 + (5 * 54 + 5) * 3;
      const color = COLORS[((i * 17) % 110) % 5];
      const target = [1, 3, 5].map(n => parseInt(color.slice(n, n + 2), 16));
      assert.ok(target.every((v, c) => Math.abs(pixels[off + c] - v) < 20), `wrong shot at ${i * 1.2 + 0.6}s`);
    }
    assert.ok(!(await fs.readdir(dir)).some(n => n.startsWith('render_')));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

import { planMotion, estimateWords } from '../../src/director/planner.ts';
import { createMusicBed } from '../../server/services/musicBed.ts';
test('one-minute directed reel retains all 50 shots with layered typography, motion, music and synchronized SFX',{timeout:1800000},async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'SceneSync directed 60s '));
  try{
    const input=await fixture(dir,110,60000),originals=input.scenes;
    const lines=['One idea can change everything','But the story needs a purpose','Every step makes real progress','Give each word a little room','200,000 followers in 8 days'];
    input.scenes=Array.from({length:50},(_,i)=>({...originals[(i*17)%110],id:`motion_${i}`,index:i,startMs:i*1200,endMs:(i+1)*1200,durationMs:1200,text:lines[i%5]}));
    input.scenes=planMotion(input.scenes,'editorial-motion',{engine:'estimated',coverage:0,words:estimateWords(input.scenes)}).scenes;
    input.motionIntensity='subtle';
    input.musicPath=path.join(dir,'original_music.wav');await createMusicBed(input.musicPath,60000,'editorial-motion');
    input.backgroundMusic={filename:'Original underscore',url:'',durationMs:60000,volumeDb:-20,duckingEnabled:true};
    const file=await renderProjectMp4(input);await validateRenderedMp4(file,60000,1800,1080,1920);
    const pixels=await runCommandBuffer('ffmpeg',['-v','error','-i',file,'-vf',`select='${input.scenes.map((_,i)=>`eq(n,${i*36+20})`).join('+')}',scale=54:96`,'-fps_mode','vfr','-pix_fmt','rgb24','-f','rawvideo','pipe:1']);
    assert.equal(pixels.length,50*54*96*3);
    for(let i=0;i<50;i++){
      const off=i*54*96*3+(56*54+25)*3,target=COLORS[((i*17)%110)%5];
      assert.ok([1,3,5].every((n,c)=>Math.abs(pixels[off+c]-parseInt(target.slice(n,n+2),16))<25),`directed shot ${i} is missing`);
    }
    assert.ok(!(await fs.readdir(dir)).some(n=>n.startsWith('render_')));
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
