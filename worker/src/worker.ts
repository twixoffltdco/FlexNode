import 'dotenv/config';
import Docker from 'dockerode';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const docker = new Docker({socketPath:'/var/run/docker.sock'});
const WORKER_ID = process.env.WORKER_ID || 'worker-1';
const ROOT = process.env.SERVER_ROOT || '/srv/flex-node/servers';
const NETWORK = process.env.DOCKER_NETWORK || 'flex-node';

function limits(s:any){
  const ram = Math.max(128, Number(s.memoryMb || 512));
  const cpu = Math.max(0.10, Number(s.cpuCores || 0.5));
  return {
    Memory: ram * 1024 * 1024,
    NanoCpus: Math.floor(cpu * 1e9),
    PidsLimit: 256,
    CpuQuota: Math.floor(cpu * 100000),
    CpuPeriod: 100000,
    BlkioWeight: 500
  };
}

async function ensureNetwork(){
  try { await docker.getNetwork(NETWORK).inspect(); }
  catch { await docker.createNetwork({Name:NETWORK,Driver:'bridge'}); }
}

async function reconcile(){
  await ensureNetwork();
  const servers = await prisma.server.findMany({where:{workerId:WORKER_ID}});
  for(const s of servers){
    const name=`flex-${s.slug}`;
    const desired=s.status;
    try{
      const c=docker.getContainer(name);
      const info=await c.inspect();
      if(desired==='RUNNING' && !info.State.Running){
        await c.start();
      } else if(desired!=='RUNNING' && info.State.Running){
        await c.stop({t:10});
      }
    }catch{
      if(desired==='RUNNING'){
        await docker.createContainer({
          name,
          Image:s.image,
          Hostname:s.slug,
          Env:[
            `FLEX_SERVER_ID=${s.id}`,
            `FLEX_SLOTS=${s.slots}`,
            `FLEX_PORT=${s.port}`
          ],
          HostConfig:{
            RestartPolicy:{Name:'unless-stopped'},
            Memory:limits(s).Memory,
            NanoCpus:limits(s).NanoCpus,
            PidsLimit:limits(s).PidsLimit,
            CpuQuota:limits(s).CpuQuota,
            CpuPeriod:limits(s).CpuPeriod,
            Binds:[`${s.rootPath}:/server`],
            PortBindings:{[`${s.port}/udp`]:[{HostPort:String(s.port)}]},
            NetworkMode:NETWORK
          },
          ExposedPorts:{[`${s.port}/udp`]:{}}
        }).then(c=>c.start());
      }
    }
  }
}

async function metrics(){
  const servers=await prisma.server.findMany({where:{workerId:WORKER_ID,status:'RUNNING'}});
  for(const s of servers){
    try{
      const c=docker.getContainer(`flex-${s.slug}`);
      const info=await c.inspect();
      const stats=await c.stats({stream:false});
      const mem=Number((stats as any).memory_stats?.usage||0);
      const cpu=Number((stats as any).cpu_stats?.cpu_usage?.total_usage||0);
      await prisma.server.update({where:{id:s.id},data:{
        containerId:info.Id,
        memoryUsageMb:Math.round(mem/1024/1024),
        cpuUsageNs:cpu,
        lastHeartbeat:new Date()
      }});
    }catch{}
  }
}

setInterval(()=>reconcile().catch(console.error),5000);
setInterval(()=>metrics().catch(console.error),10000);
await reconcile();
console.log(`Flex Node worker ${WORKER_ID} started`);
