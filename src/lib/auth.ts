import { randomBytes } from 'node:crypto';
import { getSql } from '../db';
import { AppError, type Actor } from './contracts';
import { hashToken,readToken,verifyPassword,sessionCookie } from './security';
export async function authenticate(request:Request):Promise<Actor>{
  const token=readToken(request.headers.get('cookie'));
  if(!/^[a-f0-9]{64}$/.test(token))throw new AppError(401,'Please sign in / กรุณาเข้าสู่ระบบ');
  const [user]=await getSql()`select a.id,a.tenant_id,a.username from sessions s join admins a on a.id=s.admin_id and a.tenant_id=s.tenant_id where s.token_hash=${hashToken(token)} and s.expires_at>now()`;
  if(!user)throw new AppError(401,'Session expired / เซสชันหมดอายุ');
  return {id:user.id,tenantId:user.tenant_id,username:user.username};
}
export function checkOrigin(request:Request){
  const configured=process.env.APP_ORIGIN;
  if(!configured)throw new AppError(503,'APP_ORIGIN is not configured.');
  if(request.headers.get('origin')!==new URL(configured).origin)throw new AppError(403,'Invalid request origin.');
  if(request.headers.get('sec-fetch-site')==='cross-site')throw new AppError(403,'Cross-site requests are denied.');
}
export async function login(username:string,password:string){
  const sql=getSql();
  // A single-owner application uses a durable global limiter, unaffected by attacker-controlled headers/usernames.
  const [limit]=await sql`insert into login_limits (key,attempts,reset_at) values ('owner',1,now()+interval '15 minutes') on conflict (key) do update set attempts=case when login_limits.reset_at<now() then 1 else login_limits.attempts+1 end, reset_at=case when login_limits.reset_at<now() then now()+interval '15 minutes' else login_limits.reset_at end returning attempts`;
  if(limit.attempts>10)throw new AppError(429,'Too many attempts. Try again in 15 minutes.');
  const [user]=await sql`select * from admins where username=${username}`;
  // Equalize password work for unknown usernames.
  const dummy='scrypt:00000000000000000000000000000000:'+ '00'.repeat(64);
  const valid=await verifyPassword(password,user?.password_hash||dummy);
  if(!user||!valid)throw new AppError(401,'Incorrect credentials / ข้อมูลเข้าสู่ระบบไม่ถูกต้อง');
  await sql`delete from login_limits where key='owner'`;
  const token=randomBytes(32).toString('hex');
  await sql.begin(async tx=>{
    await tx`insert into sessions (tenant_id,admin_id,token_hash,expires_at) values (${user.tenant_id},${user.id},${hashToken(token)},now()+interval '8 hours')`;
    await tx`insert into audit (tenant_id,actor_id,action) values (${user.tenant_id},${user.id},'login')`;
  });
  return {cookie:sessionCookie(token),user:{username:user.username}};
}
export async function logout(request:Request){await getSql()`delete from sessions where token_hash=${hashToken(readToken(request.headers.get('cookie')))}`;return sessionCookie('',0);}
