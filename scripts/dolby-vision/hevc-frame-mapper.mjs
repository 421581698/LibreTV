import { execFileSync } from 'node:child_process';
import { open } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// A deliberately bounded single-layer MP4 sample parser. The caller must
// independently verify sample boundaries, hvcC length size and decoded PTS.
export function extractHevcSampleRpu(sample, lengthSize) {
  if (!Buffer.isBuffer(sample) || !sample.length || sample.length > 32 * 1024 * 1024 ||
      ![1, 2, 4].includes(lengthSize)) throw new Error('Invalid HEVC sample');
  let offset = 0;
  let pictures = 0;
  let rpu = null;
  let count = 0;
  while (offset < sample.length) {
    if (++count > 65536 || offset + lengthSize > sample.length) throw new Error('Invalid NAL boundary');
    const size = sample.readUIntBE(offset, lengthSize);
    offset += lengthSize;
    if (size < 3 || size > sample.length - offset) throw new Error('Invalid NAL size');
    const nal = sample.subarray(offset, offset + size);
    offset += size;
    const type = (nal[0] >> 1) & 63;
    const layer = ((nal[0] & 1) << 5) | (nal[1] >> 3);
    if ((nal[0] & 128) || layer !== 0 || !(nal[1] & 7)) throw new Error('Unsupported HEVC NAL header');
    if (type <= 31) {
      if (nal[2] & 128) pictures++;
      else if (!pictures) throw new Error('Missing first slice');
    }
    if (type === 62) {
      if (rpu || nal[0] !== 0x7c || nal[1] !== 1 || nal[2] !== 0x19 || nal.length < 9) throw new Error('Ambiguous RPU');
      rpu = nal.subarray(2);
    }
  }
  if (pictures !== 1 || !rpu) throw new Error('Expected exactly one picture and one RPU');
  return { rpuSha256: createHash('sha256').update(rpu).digest('hex'), rpu };
}

/** Bind independently probed decoded timestamps to exact MP4 sample bytes.
 * Packet order may differ from presentation order; no positional guessing.
 */
export function bindHevcDecodedFrames(samples, decodedPts, lengthSize) {
  if (!Array.isArray(samples) || !Array.isArray(decodedPts) ||
      !samples.length || samples.length > 8192 || samples.length !== decodedPts.length) {
    throw new Error('Incomplete HEVC frame evidence');
  }
  const canonicalPts = value => {
    if (typeof value !== 'string' || !/^(?:0|-?[1-9][0-9]{0,18})$/.test(value)) throw new Error('Invalid PTS');
    const pts = BigInt(value);
    if (pts < -(1n << 63n) || pts >= (1n << 63n)) throw new Error('PTS out of range');
    return pts;
  };
  const byPts = new Map();
  for (const sample of samples) {
    canonicalPts(sample.pts);
    if (byPts.has(sample.pts)) throw new Error('Duplicate sample PTS');
    byPts.set(sample.pts, extractHevcSampleRpu(sample.bytes, lengthSize).rpuSha256);
  }
  let previous = null;
  return decodedPts.map((pts, frameOrdinal) => {
    const value = canonicalPts(pts);
    if (!byPts.has(pts) || (previous !== null && value <= previous)) throw new Error('Unmatched or unordered decoded frame');
    previous = value;
    const rpuSha256 = byPts.get(pts);
    byPts.delete(pts);
    return { frameOrdinal, pts, rpuSha256 };
  });
}

/** Probe a local, clear MP4 with a trusted hvcC NAL length size.
 * Compact output preserves exact int64 timestamps rather than JSON numbers.
 */
export async function probeHevcFrameMapping(path, lengthSize, ffprobe = 'ffprobe') {
  const probe = args => execFileSync(ffprobe, [
    '-v','error','-protocol_whitelist','file','-f','mov','-enable_drefs','0',
    '-select_streams','v:0', ...args, '-of','compact=p=1:nk=0',path,
  ], {encoding:'utf8', timeout:900000, maxBuffer:16*1024*1024, stdio:['ignore','pipe','pipe']}).trim().split(/\r?\n/);
  if (lengthSize === null) {
    const raw = execFileSync(ffprobe, ['-v','error','-protocol_whitelist','file','-f','mov','-enable_drefs','0','-select_streams','v:0','-show_entries','stream=extradata','-show_data','-of','default=nw=1:nk=1',path], {encoding:'utf8',timeout:30000,maxBuffer:65536});
    const hex = raw.split(/\r?\n/).map(line => /^\s*[0-9a-f]{8}:\s+([0-9a-f ]+?)\s{2,}/i.exec(line)?.[1]?.replace(/ /g,'') || '').join('');
    const config = Buffer.from(hex,'hex');
    if (config.length < 23 || config[0] !== 1 || (config[21] & 3) === 2) throw new Error('Invalid hvcC configuration');
    lengthSize = (config[21] & 3) + 1;
  }
  const stream = probe(['-show_streams','-show_entries','stream=codec_name,time_base']);
  if (stream.length !== 1) throw new Error('Ambiguous HEVC stream');
  const fields = stream[0].split('|');
  const codec = fields.filter(field => field.startsWith('codec_name='));
  const bases = fields.filter(field => field.startsWith('time_base='));
  const match = fields[0] === 'stream' && codec.length === 1 && codec[0] === 'codec_name=hevc' && bases.length === 1
    ? /^time_base=(\d+)\/(\d+)$/.exec(bases[0]) : null;
  if (!match) throw new Error('Invalid HEVC timebase');
  const timeBase = {numerator:Number(match[1]),denominator:Number(match[2])};
  if (Object.values(timeBase).some(n=>!Number.isSafeInteger(n)||n<=0)) throw new Error('Invalid timebase');
  const packets = probe(['-fflags','+noparse+nofillin','-show_packets','-show_entries','packet=pts,size,pos']).filter(row => row.startsWith('packet|'));
  const frames = probe(['-show_frames','-show_entries','frame=best_effort_timestamp']).filter(row => row.startsWith('frame|'));
  if (!packets.length || packets.length>8192 || packets.length!==frames.length) throw new Error(`Incomplete frame evidence: packets=${packets.length}, frames=${frames.length}`);
  const file = await open(path,'r');
  try {
    const stat = await file.stat();
    const ranges = [];
    let total=0;
    for (const row of packets) {
      const m=/^packet\|pts=(-?\d{1,19})\|size=(\d+)\|pos=(\d+)$/.exec(row);
      if (!m) throw new Error('Invalid packet evidence');
      const size=Number(m[2]), pos=Number(m[3]);
      if (!Number.isSafeInteger(size)||!Number.isSafeInteger(pos)||size<=0||size>32*1024*1024||pos<0||pos>stat.size-size||(total+=size)>256*1024*1024) throw new Error('Packet bounds exceeded');
      ranges.push({pts:m[1],size,pos});
    }
    const ordered=[...ranges].sort((a,b)=>a.pos-b.pos);
    for(let i=1;i<ordered.length;i++) if(ordered[i].pos<ordered[i-1].pos+ordered[i-1].size) throw new Error('Overlapping packets');
    const samples=[];
    for(const range of ranges){
      const bytes=Buffer.alloc(range.size);
      const result=await file.read(bytes,0,range.size,range.pos);
      if(result.bytesRead!==range.size) throw new Error('Short sample read');
      samples.push({pts:range.pts,bytes});
    }
    const decodedPts=frames.map(row=>{
      const fields = row.split('|');
      const timestamps = fields.filter(field => field.startsWith('best_effort_timestamp='));
      const m = fields[0] === 'frame' && timestamps.length === 1 ? /^best_effort_timestamp=(-?\d{1,19})$/.exec(timestamps[0]) : null;
      if(!m) throw new Error('Invalid decoded frame evidence');
      return m[1];
    });
    return {timeBase,frames:bindHevcDecodedFrames(samples,decodedPts,lengthSize)};
  } finally {await file.close();}
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  probeHevcFrameMapping(process.argv[2], null, process.argv[3]).then(result => process.stdout.write(JSON.stringify(result))).catch(error => { console.error(error.message); process.exitCode=1; });
}
