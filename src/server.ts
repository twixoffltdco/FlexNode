import 'dotenv/config';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import formbody from '@fastify/formbody';
import multipart from '@fastify/multipart';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { nanoid } from 'nanoid';
import { mkdir, readdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const prisma = new PrismaClient();
const app = Fastify({ logger: true });
await app.register(cookie);
await app.register(cors, { origin: true, credentials: true });
await app.register(formbody);
await app.register(multipart);

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const ROOT = process.env.SERVER_ROOT || '/srv/flex-node/servers';
const PUBLIC_HOST = process.env.PUBLIC_HOST || 'localhost';
const PORT = Number(process.env.PORT || 3000);

type Auth = { id: string; email: string };

function sign(user: Auth) {
  return jwt.sign(user, JWT_SECRET, { expiresIn: '30d' });
}
function auth(req: any): Auth {
  const token = req.cookies.session;
  if (!token) throw new Error('UNAUTHORIZED');
  return jwt.verify(token, JWT_SECRET) as Auth;
}
function safePath(base: string, input: string) {
  const resolved = path.resolve(base, input || '.');
  if (resolved !== path.resolve(base) && !resolved.startsWith(path.resolve(base) + path.sep)) {
    throw new Error('INVALID_PATH');
  }
  return resolved;
}
function run(cmd: string, args: string[]) {
  return new Promise<{ stdout: string; stderr: string; code: number }>((resolve) => {
    const p = spawn(cmd, args);
    let stdout='', stderr='';
    p.stdout.on('data', d => stdout += d);
    p.stderr.on('data', d => stderr += d);
    p.on('close', code => resolve({ stdout, stderr, code: code ?? 1 }));
  });
}

app.get('/api/health', async () => ({ ok: true, service: 'Flex Node' }));

app.post('/api/auth/register', async (req, reply) => {
  const body = req.body as any;
  if (!body?.email || !body?.password || body.password.length < 8) return reply.code(400).send({ error: 'Email и пароль от 8 символов обязательны' });
  const exists = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
  if (exists) return reply.code(409).send({ error: 'Пользователь уже существует' });
  const passwordHash = await bcrypt.hash(body.password, 12);
  const user = await prisma.user.create({ data: { email: body.email.toLowerCase(), passwordHash } });
  reply.setCookie('session', sign({ id: user.id, email: user.email }), { httpOnly: true, sameSite: 'lax', secure: false, path: '/', maxAge: 60*60*24*30 });
  return { id: user.id, email: user.email };
});

app.post('/api/auth/login', async (req, reply) => {
  const body = req.body as any;
  const user = await prisma.user.findUnique({ where: { email: String(body?.email || '').toLowerCase() } });
  if (!user || !(await bcrypt.compare(body?.password || '', user.passwordHash))) return reply.code(401).send({ error: 'Неверный логин или пароль' });
  reply.setCookie('session', sign({ id: user.id, email: user.email }), { httpOnly: true, sameSite: 'lax', secure: false, path: '/', maxAge: 60*60*24*30 });
  return { id: user.id, email: user.email };
});

app.post('/api/auth/logout', async (_req, reply) => {
  reply.clearCookie('session', { path: '/' });
  return { ok: true };
});

app.get('/api/me', async (req, reply) => {
  try { return auth(req); } catch { return reply.code(401).send({ error: 'UNAUTHORIZED' }); }
});

app.get('/api/servers', async (req, reply) => {
  try {
    const u = auth(req);
    return prisma.server.findMany({ where: { userId: u.id }, orderBy: { createdAt: 'desc' } });
  } catch { return reply.code(401).send({ error: 'UNAUTHORIZED' }); }
});

app.post('/api/servers', async (req, reply) => {
  try {
    const u = auth(req);
    const body = req.body as any;
    const port = Number(body.port);
    const slots = Number(body.slots || 100);
    if (!body.name || !Number.isInteger(port) || port < 1000 || port > 65535) return reply.code(400).send({ error: 'Некорректное имя или порт' });
    const slug = `${body.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')}-${nanoid(6).toLowerCase()}`;
    const rootPath = path.join(ROOT, slug);
    await mkdir(rootPath, { recursive: true });
    await writeFile(path.join(rootPath, 'server.cfg'), `hostname ${body.name}\nmaxplayers ${slots}\nport ${port}\nrcon_password change-me\n`);
    const server = await prisma.server.create({ data: { userId: u.id, name: body.name, slug, slots, port, rootPath } });
    return server;
  } catch (e:any) { return reply.code(400).send({ error: e.message }); }
});

app.post('/api/servers/:id/:action', async (req, reply) => {
  try {
    const u = auth(req);
    const s = await prisma.server.findFirst({ where: { id: (req.params as any).id, userId: u.id } });
    if (!s) return reply.code(404).send({ error: 'SERVER_NOT_FOUND' });
    const action = (req.params as any).action;
    const cname = `flex-${s.slug}`;
    if (action === 'start') {
      await run('docker', ['rm','-f',cname]);
      const r = await run('docker', ['run','-d','--name',cname,'--restart','unless-stopped','--network',process.env.DOCKER_NETWORK || 'bridge','-p',`${s.port}:${s.port}/udp`,'-v',`${s.rootPath}:/server`,s.image]);
      if (r.code !== 0) return reply.code(500).send({ error: r.stderr });
      const updated = await prisma.server.update({ where: { id: s.id }, data: { containerId: r.stdout.trim(), status: 'RUNNING' } });
      return updated;
    }
    if (action === 'stop') {
      await run('docker', ['stop', cname]);
      return prisma.server.update({ where: { id: s.id }, data: { status: 'STOPPED' } });
    }
    if (action === 'restart') {
      await run('docker', ['restart', cname]);
      return prisma.server.update({ where: { id: s.id }, data: { status: 'RUNNING' } });
    }
    return reply.code(400).send({ error: 'UNKNOWN_ACTION' });
  } catch (e:any) { return reply.code(400).send({ error: e.message }); }
});

app.get('/api/servers/:id/files', async (req, reply) => {
  try {
    const u=auth(req); const s=await prisma.server.findFirst({where:{id:(req.params as any).id,userId:u.id}});
    if(!s) return reply.code(404).send({error:'SERVER_NOT_FOUND'});
    const dir=safePath(s.rootPath,String((req.query as any)?.path||'.'));
    const items=await readdir(dir,{withFileTypes:true});
    return Promise.all(items.map(async x=>({name:x.name,type:x.isDirectory()?'dir':'file',size:x.isFile()?(await stat(path.join(dir,x.name))).size:0})));
  } catch(e:any){return reply.code(400).send({error:e.message});}
});

app.get('/api/servers/:id/file', async (req, reply) => {
  try {
    const u=auth(req); const s=await prisma.server.findFirst({where:{id:(req.params as any).id,userId:u.id}});
    if(!s) return reply.code(404).send({error:'SERVER_NOT_FOUND'});
    const file=safePath(s.rootPath,String((req.query as any)?.path||''));
    return {path:(req.query as any).path,content:await readFile(file,'utf8')};
  } catch(e:any){return reply.code(400).send({error:e.message});}
});

app.put('/api/servers/:id/file', async (req, reply) => {
  try {
    const u=auth(req); const s=await prisma.server.findFirst({where:{id:(req.params as any).id,userId:u.id}});
    if(!s) return reply.code(404).send({error:'SERVER_NOT_FOUND'});
    const b=req.body as any; const file=safePath(s.rootPath,String(b.path||''));
    await mkdir(path.dirname(file),{recursive:true}); await writeFile(file,String(b.content||''));
    return {ok:true};
  } catch(e:any){return reply.code(400).send({error:e.message});}
});

app.post('/api/servers/:id/upload', async (req, reply) => {
  try {
    const u=auth(req); const s=await prisma.server.findFirst({where:{id:(req.params as any).id,userId:u.id}});
    if(!s) return reply.code(404).send({error:'SERVER_NOT_FOUND'});
    const parts=req.parts(); let count=0;
    for await (const part of parts) {
      if (part.type === 'file') {
        const target=safePath(s.rootPath, String(req.headers['x-target-path'] || '') + '/' + path.basename(part.filename));
        await mkdir(path.dirname(target),{recursive:true});
        await writeFile(target, await part.toBuffer()); count++;
      }
    }
    return {ok:true,count};
  } catch(e:any){return reply.code(400).send({error:e.message});}
});

app.delete('/api/servers/:id/file', async (req, reply) => {
  try {
    const u=auth(req); const s=await prisma.server.findFirst({where:{id:(req.params as any).id,userId:u.id}});
    if(!s) return reply.code(404).send({error:'SERVER_NOT_FOUND'});
    await rm(safePath(s.rootPath,String((req.query as any)?.path||'')),{recursive:true,force:true});
    return {ok:true};
  } catch(e:any){return reply.code(400).send({error:e.message});}
});

app.get('/api/servers/:id/logs', async (req, reply) => {
  try {
    const u=auth(req); const s=await prisma.server.findFirst({where:{id:(req.params as any).id,userId:u.id}});
    if(!s) return reply.code(404).send({error:'SERVER_NOT_FOUND'});
    const r=await run('docker',['logs','--tail','300',`flex-${s.slug}`]);
    return {logs:(r.stdout+r.stderr).slice(-30000)};
  } catch(e:any){return reply.code(400).send({error:e.message});}
});

app.listen({ port: PORT, host: '0.0.0.0' });
