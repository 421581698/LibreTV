/**
 * Optional shared cancellation coordination across server instances.
 * An Upstash Redis REST database is configured with the two environment
 * secrets below; no client-controlled URL or Redis command is accepted.
 * Without it the cancellation API reports local-only semantics explicitly.
 */
export type CancellationStoreStatus='disabled'|'configured'|'invalid';

export function cancellationStoreStatus():CancellationStoreStatus {
  const url=process.env.UPSTASH_REDIS_REST_URL;
  const token=process.env.UPSTASH_REDIS_REST_TOKEN;
  if(!url&&!token)return 'disabled';
  if(!url||!token)return 'invalid';
  try {
    const parsed=new URL(url);
    if(parsed.protocol!=='https:'||!parsed.hostname||parsed.username||parsed.password||
       parsed.search||parsed.hash||parsed.pathname!=='/')return 'invalid';
  }catch{return 'invalid';}
  return 'configured';
}

const TTL_SECONDS=120;
const POLL_MS=500;
const REQUEST_TIMEOUT_MS=3000;
function keyFor(requestId:string,userId:string):string {
  return 'libretv:chat:cancel:v1:'+encodeURIComponent(userId)+':'+encodeURIComponent(requestId);
}
async function redis(command:string[]):Promise<string|null> {
  if(cancellationStoreStatus()!=='configured')throw new Error('Shared cancellation not configured');
  const response=await fetch(process.env.UPSTASH_REDIS_REST_URL!,{
    method:'POST',
    headers:{
      Authorization:'Bearer '+process.env.UPSTASH_REDIS_REST_TOKEN!,
      'Content-Type':'application/json',
    },
    body:JSON.stringify(command),
    signal:AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache:'no-store',
    redirect:'error',
  });
  if(!response.ok)throw new Error('Shared cancellation backend unavailable');
  const data=await response.json() as {result?:unknown;error?:unknown};
  if(data.error||!('result' in data))throw new Error('Shared cancellation command failed');
  return typeof data.result==='string'?data.result:null;
}
export async function publishDistributedCancellation(requestId:string,userId:string):Promise<void>{
  if(await redis(['SET',keyFor(requestId,userId),userId,'EX',String(TTL_SECONDS)])!=='OK')
    throw new Error('Shared cancellation write failed');
}

/** Poll immediately and thereafter while the registered stream is alive.
 * A failed configured coordinator aborts rather than falsely promising
 * cross-instance cancellation. The interval is released on unregister.
 */
export function watchDistributedCancellation(
  requestId:string,userId:string,controller:AbortController,
):()=>void {
  const status=cancellationStoreStatus();
  if(status==='disabled')return ()=>{};
  if(status==='invalid'){
    controller.abort(new Error('Shared cancellation configuration invalid'));
    return ()=>{};
  }
  let stopped=false;
  let checking=false;
  const check=async()=>{
    if(stopped||checking||controller.signal.aborted)return;
    checking=true;
    try{
      const value=await redis(['GET',keyFor(requestId,userId)]);
      if(!stopped&&value===userId)
        controller.abort(new Error('CANCELLED_BY_CLIENT'));
    }catch{
      if(!stopped)controller.abort(new Error('Shared cancellation backend unavailable'));
    }finally{checking=false;}
  };
  const interval=setInterval(()=>{void check();},POLL_MS);
  const stop=()=>{
    stopped=true;
    clearInterval(interval);
    controller.signal.removeEventListener('abort',stop);
  };
  controller.signal.addEventListener('abort',stop,{once:true});
  if(controller.signal.aborted)stop();
  else void check();
  return stop;
}
