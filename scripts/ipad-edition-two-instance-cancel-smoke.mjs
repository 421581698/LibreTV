#!/usr/bin/env node
/**
 * Two *OS process* cancellation integration smoke, using a shared mock Redis
 * REST protocol server. No real Upstash credentials or production service.
 * Real Redis connectivity and deployment routing remain separate gates.
 */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {build} from 'esbuild';

const tmp=await mkdtemp(join(tmpdir(),'libretv-two-instance-cancel-'));
const mockStore=new Map();
let lookupCount=0;
const server=createServer(async(req,res)=>{
  try{
    assert.equal(req.method,'POST');
    assert.equal(req.headers.authorization,'Bearer integration-test-token');
    const chunks=[];
    for await(const part of req)chunks.push(part);
    const [operation,key,value,expiryFlag,ttl]=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const now=Date.now();
    if(operation==='SET'){
      assert.equal(expiryFlag,'EX');
      assert.equal(ttl,'120');
      mockStore.set(key,{value,expires:now+120_000});
      res.end(JSON.stringify({result:'OK'}));
    }else if(operation==='GET'){
      lookupCount++;
      const record=mockStore.get(key);
      res.end(JSON.stringify({result:record&&record.expires>now?record.value:null}));
    }else{
      res.writeHead(400);res.end(JSON.stringify({error:'invalid command'}));
    }
  }catch(error){
    res.writeHead(500);res.end(JSON.stringify({error:String(error)}));
  }
});
const workerSource=`
const {watchDistributedCancellation,publishDistributedCancellation}=
  require(process.env.INTEGRATION_MODULE);
const nativeFetch=globalThis.fetch;
globalThis.fetch=(_url,options)=>nativeFetch(process.env.INTEGRATION_MOCK_REDIS,options);
let stop=()=>{},controller=null;
process.on('message',async message=>{
  try{
    if(message.action==='watch'){
      stop();
      controller=new AbortController();
      controller.signal.addEventListener('abort',()=>{
        process.send({event:'aborted',id:message.id});
      },{once:true});
      stop=watchDistributedCancellation(message.id,message.user,controller);
      process.send({event:'watching',id:message.id});
    }else if(message.action==='publish'){
      await publishDistributedCancellation(message.id,message.user);
      process.send({event:'published',id:message.id});
    }else if(message.action==='stop'){
      stop();
      process.send({event:'stopped',id:message.id});
    }
  }catch(error){process.send({event:'error',message:String(error)});}
});
`;
const workers=[];
function waitFor(worker,event,id,timeout=5000){
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{clear();reject(new Error('Timed out waiting for '+event+':'+id));},timeout);
    const onMessage=message=>{
      if(message.event==='error'){clear();reject(new Error(message.message));}
      if(message.event===event&&message.id===id){clear();resolve(message);}
    };
    const onExit=code=>{clear();reject(new Error('Worker exited while waiting: '+code));};
    function clear(){clearTimeout(timer);worker.off('message',onMessage);worker.off('exit',onExit);}
    worker.on('message',onMessage);worker.on('exit',onExit);
  });
}
async function command(worker,action,event,id,user){
  const ready=waitFor(worker,event,id);
  worker.send({action,id,user});
  await ready;
}
async function noMessage(worker,event,id,ms){
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{worker.off('message',listener);resolve();},ms);
    const listener=message=>{
      if(message.event===event&&message.id===id){
        clearTimeout(timer);worker.off('message',listener);
        reject(new Error('Unexpected '+event+' event for '+id));
      }
    };
    worker.on('message',listener);
  });
}
try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();
  if(!address||typeof address==='string')throw new Error('No mock Redis port');
  const mockUrl='http://127.0.0.1:'+address.port+'/';
  const modulePath=join(tmp,'distributed-cancellation.cjs');
  await build({
    entryPoints:[resolve('src/lib/infra/distributed-cancellation.ts')],
    platform:'node',format:'cjs',bundle:true,outfile:modulePath,logLevel:'silent',
  });
  const workerPath=join(tmp,'instance.cjs');
  await writeFile(workerPath,workerSource);
  const env={...process.env,
    UPSTASH_REDIS_REST_URL:'https://test-redis.upstash.io/',
    UPSTASH_REDIS_REST_TOKEN:'integration-test-token',
    INTEGRATION_MODULE:modulePath,INTEGRATION_MOCK_REDIS:mockUrl,
  };
  function start(){
    const worker=spawn(process.execPath,[workerPath],{env,stdio:['ignore','pipe','pipe','ipc']});
    workers.push(worker);
    return worker;
  }
  const instanceA=start(),instanceB=start();
  const wrongId='isolated-wrong-owner';
  await command(instanceA,'watch','watching',wrongId,'owner-a');
  await command(instanceB,'publish','published',wrongId,'owner-b');
  await noMessage(instanceA,'aborted',wrongId,750);
  await command(instanceA,'stop','stopped',wrongId);
  const target='isolated-target';
  await command(instanceA,'watch','watching',target,'owner-a');
  const aborted=waitFor(instanceA,'aborted',target,4000);
  await command(instanceB,'publish','published',target,'owner-a');
  await aborted;
  const checksAtAbort=lookupCount;
  await new Promise(resolve=>setTimeout(resolve,750));
  assert.equal(lookupCount,checksAtAbort,'Polling still active after remote abort');
  const early='isolated-early';
  await command(instanceB,'publish','published',early,'owner-a');
  const earlyAbort=waitFor(instanceA,'aborted',early,4000);
  await command(instanceA,'watch','watching',early,'owner-a');
  await earlyAbort;
  console.log('PASS: two isolated Node processes, shared REST protocol, user isolation, remote cancellation, early cancellation, poll cleanup');
  console.log('NOTE: this is a mock Redis protocol server; real hosted Redis and two deployed instances remain unverified');
}finally{
  for(const worker of workers)worker.kill();
  await new Promise(resolve=>server.close(()=>resolve()));
  await rm(tmp,{recursive:true,force:true});
}
