import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const {lookup}=vi.hoisted(()=>({lookup:vi.fn()}));
vi.mock('node:dns',()=>({lookup}));
import {createServer} from 'node:http';
import {fetchWithValidatedNodeSocket,guardedSocketLookup,validateSocketAddresses} from './node-guarded-fetch';

beforeEach(()=>vi.resetAllMocks());
afterEach(()=>vi.unstubAllGlobals());

describe('actual DNS socket connection target guard',()=>{
  it('rejects private or mixed DNS replies at the connection lookup, even after a public preflight',()=>{
    const respond=vi.fn();
    lookup.mockImplementation((_host,_opts,cb)=>{
      cb(null,[{address:'8.8.8.8',family:4},{address:'169.254.169.254',family:4}]);
    });
    guardedSocketLookup('rebinding.example',{all:false},respond);
    expect(respond).toHaveBeenCalledOnce();
    expect(respond.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(respond.mock.calls[0][1]).toBeUndefined();
  });
  it('rejects a rebinding lookup through the real HTTP dispatcher before reaching a local listener',async()=>{
    let requests=0;
    const server=createServer((_req,res)=>{requests++;res.end('unexpected');});
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    try {
      const address=server.address();
      if(!address||typeof address==='string')throw new Error('Missing test listener');
      lookup.mockImplementation((_host,_opts,cb)=>cb(null,[{address:'127.0.0.1',family:4}]));
      await expect(fetchWithValidatedNodeSocket(
        'http://rebind-integration.example:'+address.port,
        {redirect:'manual',signal:AbortSignal.timeout(3000)},
      )).rejects.toThrow();
      expect(lookup).toHaveBeenCalled();
      expect(requests).toBe(0);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    }
  });
  it('returns only checked public addresses to socket dialer',()=>{
    const respond=vi.fn();
    lookup.mockImplementation((_host,_opts,cb)=>{
      cb(null,[{address:'8.8.8.8',family:4},{address:'2606:4700::1111',family:6}]);
    });
    guardedSocketLookup('public.example',{all:false},respond);
    expect(respond).toHaveBeenCalledWith(null,'8.8.8.8',4);
  });
  it('preserves all-address callback shape when Node requests it',()=>{
    const respond=vi.fn();
    lookup.mockImplementation((_host,_opts,cb)=>{
      cb(null,[{address:'2606:4700::1111',family:6}]);
    });
    guardedSocketLookup('v6.example',{all:true},respond);
    expect(respond).toHaveBeenCalledWith(null,[{address:'2606:4700::1111',family:6}]);
  });
  it('rejects DNS outages, empty answers and private IPv4-mapped IPv6',()=>{
    expect(()=>validateSocketAddresses([])).toThrow();
    expect(()=>validateSocketAddresses([{address:'::ffff:127.0.0.1',family:6}])).toThrow();
    expect(()=>validateSocketAddresses([{address:'10.0.0.1',family:4}])).toThrow();
    const respond=vi.fn();
    lookup.mockImplementation((_host,_opts,cb)=>cb(Object.assign(new Error('ENOTFOUND'),{code:'ENOTFOUND'})));
    guardedSocketLookup('missing.example',{all:false},respond);
    expect(respond.mock.calls[0][0]).toBeInstanceOf(Error);
  });
});
