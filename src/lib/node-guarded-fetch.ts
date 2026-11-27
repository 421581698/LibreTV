/**
 * Node-only egress connection guard. DNS is checked at socket lookup time,
 * not only before fetch(). TLS SNI and Host remain the original URL hostname.
 * The shared Undici Agent never performs an unchecked re-resolution.
 * Cloudflare Workers use their own strictly-public platform fetch policy.
 */
import {lookup, type LookupAddress} from 'node:dns';
import {Agent} from 'undici';
import {isPrivateIP} from './ssrf';

export function validateSocketAddresses(addresses:readonly LookupAddress[]):LookupAddress[] {
  if(!addresses.length||addresses.some(item=>
    (item.family!==4&&item.family!==6)||isPrivateIP(item.address)))
    throw new Error('Socket DNS resolved to non-public or invalid IP address');
  return [...addresses];
}

/** Use the same validated addresses as the socket lookup callback; no TOCTOU gap. */
export const guardedSocketLookup=((hostname:string,options:unknown,callback:(
  error:NodeJS.ErrnoException|null,address?:string|LookupAddress[],family?:number,
)=>void)=>{
  const opts=(options??{}) as {all?:boolean;family?:number;hints?:number};
  lookup(hostname,{all:true,verbatim:true,
    ...(opts.family?{family:opts.family}:{}),
    ...(opts.hints?{hints:opts.hints}:{})},
  (error,addresses)=>{
    if(error){callback(error);return;}
    try{
      const accepted=validateSocketAddresses(addresses);
      if(opts.all)callback(null,accepted);
      else callback(null,accepted[0].address,accepted[0].family);
    }catch{
      callback(new Error('Connection to private DNS destination rejected') as NodeJS.ErrnoException);
    }
  });
}) as typeof lookup;

// Connection pools may reuse a previously validated public socket. Every
// new socket goes through guardedSocketLookup, including retry connections.
const guardedAgent=new Agent({
  connections:4,
  connect:{lookup:guardedSocketLookup,timeout:5000},
});

export function fetchWithValidatedNodeSocket(
  url:string,init:Omit<RequestInit,'redirect'> & {redirect?:RequestRedirect},
):Promise<Response> {
  // The dispatcher is supported by Node's Undici-backed fetch but not
  // included in the cross-platform TypeScript RequestInit definition.
  return fetch(url,{...init,dispatcher:guardedAgent} as RequestInit);
}
