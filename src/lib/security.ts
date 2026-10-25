import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt=promisify(scryptCb);
export const hashToken=(token:string)=>createHash('sha256').update(token).digest('hex');
export async function hashPassword(password:string){
  if(password.length<14||password.length>256)throw new Error('Password must contain 14–256 characters.');
  const salt=randomBytes(16).toString('hex');const hash=await scrypt(password,salt,64) as Buffer;
  return `scrypt:${salt}:${hash.toString('hex')}`;
}
export async function verifyPassword(password:string,stored:string){
  if(password.length>256)return false;
  const [kind,salt,encoded]=stored.split(':');if(kind!=='scrypt'||!salt||!encoded)return false;
  const expected=Buffer.from(encoded,'hex');const actual=await scrypt(password,salt,64) as Buffer;
  return expected.length===actual.length&&timingSafeEqual(expected,actual);
}
export function sessionCookie(token:string,maxAge=8*3600){return `go365_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${process.env.COOKIE_SECURE==='true'?'; Secure':''}`;}
export function readToken(cookie:string|null){return cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('go365_session='))?.slice(14)||'';}
