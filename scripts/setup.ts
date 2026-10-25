import { getSql,closeDb } from '../src/db';
import { hashPassword } from '../src/lib/security';
try{
  const username=process.env.ADMIN_USERNAME?.trim();const password=process.env.ADMIN_PASSWORD;
  if(!username||!password)throw new Error('Set ADMIN_USERNAME and ADMIN_PASSWORD (14+ characters) in your shell; never pass a password as a command argument.');
  if(username.length>100)throw new Error('Username must be at most 100 characters.');
  const passwordHash=await hashPassword(password);
  await getSql().begin(async tx=>{
    await tx`select pg_advisory_xact_lock(365)`;
    const [count]=await tx`select count(*)::int as n from admins`;if(count.n)throw new Error('Administrator already exists. Setup is disabled.');
    const [tenant]=await tx`insert into tenants (name) values ('GO365') returning id`;
    await tx`insert into admins (tenant_id,username,password_hash) values (${tenant.id},${username},${passwordHash})`;
  });console.log('GO365 administrator created. No password was logged.');
}catch(e){console.error((e as Error).message);process.exitCode=1;}finally{await closeDb();}
