import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractHevcSampleRpu, bindHevcDecodedFrames } from './hevc-frame-mapper.mjs';
const picture = Buffer.from([2,1,128]);
const rpu = Buffer.from([124,1,25,1,2,3,4,5,128]);
const sample = (...units) => Buffer.concat(units.flatMap(unit => [Buffer.from([0,0,0,unit.length]),unit]));
test('extracts one picture and one RPU', () => {
  assert.deepEqual(extractHevcSampleRpu(sample(picture,rpu),4).rpu,rpu.subarray(2));
});
test('rejects missing, duplicate and truncated units', () => {
  for (const bytes of [sample(picture),sample(picture,rpu,rpu),sample(picture,picture,rpu),sample(picture,rpu).subarray(0,-1)]) {
    assert.throws(() => extractHevcSampleRpu(bytes,4));
  }
});

test('binds reordered packets by exact decoded PTS', () => {
  const bytes = sample(picture,rpu);
  const packets = [{pts:'9007199254740993',bytes},{pts:'9007199254740992',bytes}];
  const frames = bindHevcDecodedFrames(packets,['9007199254740992','9007199254740993'],4);
  assert.equal(frames[0].pts,'9007199254740992');
  assert.equal(frames[1].frameOrdinal,1);
  for (const pts of [['9007199254740992'],['9007199254740992','9007199254740992'],['9007199254740992','9007199254740994']]) {
    assert.throws(() => bindHevcDecodedFrames(packets,pts,4));
  }
});

test('accepts header-only EOS and EOB but rejects truncated picture and RPU', () => {
  const eos = Buffer.from([72,1]);
  const eob = Buffer.from([74,1]);
  assert.deepEqual(extractHevcSampleRpu(sample(picture,rpu,eos,eob),4).rpu,rpu.subarray(2));
  for (const unit of [Buffer.from([2,1]),Buffer.from([124,1]),Buffer.from([64,1])]) {
    assert.throws(() => extractHevcSampleRpu(sample(picture,rpu,unit),4), /Invalid NAL size/);
  }
});
