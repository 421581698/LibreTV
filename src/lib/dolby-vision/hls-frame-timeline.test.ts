import { describe, expect, it } from 'vitest';
import { verifyHlsFramePresentationOrder, verifyHlsFixedCadence, verifyHlsVariableCadence } from './hls-frame-timeline';
const fragment = (pts: string[], denominator = 90000) => ({
  timeBase: { numerator: 1, denominator },
  frames: pts.map((pts, frameOrdinal) => ({ pts, frameOrdinal, rpuSha256: 'a'.repeat(64) })),
});
describe('HLS exact presentation order', () => {
  it('compares different timebases without floating point rounding', () => {
    expect(verifyHlsFramePresentationOrder([fragment(['0', '45000']), fragment(['48000'], 48000)])).toBe(true);
    expect(verifyHlsFramePresentationOrder([fragment(['9007199254740992']), fragment(['9007199254740993'])])).toBe(true);
  });
  it('rejects repeated or reversed presentation times and empty fragments', () => {
    expect(verifyHlsFramePresentationOrder([fragment(['45000']), fragment(['24000'], 48000)])).toBe(false);
    expect(verifyHlsFramePresentationOrder([fragment(['90000']), fragment(['0'])])).toBe(false);
    expect(verifyHlsFramePresentationOrder([fragment([])])).toBe(false);
  });
});

it('proves fixed cadence only with complete registered counts and exact spacing', () => {
  const registered = [0,1].map(() => ({sampleCount:2,sampleDuration:6006,timescale:90000}));
  expect(verifyHlsFixedCadence([fragment(['0','3003']),fragment(['6006','9009'])],registered)).toBe(true);
  expect(verifyHlsFixedCadence([fragment(['0','3003']),fragment(['9009','12012'])],registered)).toBe(false);
  expect(verifyHlsFixedCadence([fragment(['0','3003']),fragment(['6006'])],registered)).toBe(false);
});

it('checks variable cadence against independent durations and anchors', () => {
  const frames = [fragment(['0','3000']),fragment(['7500','9000'])];
  const evidence = [
    {timescale:90000,start:'0',end:'7500',durations:[3000,4500]},
    {timescale:90000,start:'7500',end:'12000',durations:[1500,3000]},
  ];
  expect(verifyHlsVariableCadence(frames,evidence)).toBe(true);
  expect(verifyHlsVariableCadence(frames,[{...evidence[0],durations:[3500,4000]},evidence[1]])).toBe(false);
  expect(verifyHlsVariableCadence(frames,[evidence[0],{...evidence[1],end:'12001'}])).toBe(false);
  expect(verifyHlsVariableCadence([frames[0],fragment(['8000','9500'])],[evidence[0],{...evidence[1],start:'8000',end:'12500'}])).toBe(false);
});
