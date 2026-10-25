import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,readFile,access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes,randomUUID,createHmac } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import EmbeddedPostgres from 'embedded-postgres';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { getDb,getSql,closeDb } from '../src/db';
import { upload,mapImport,confirmImport,workOnce,importStatus,retryImport,cleanupExpired } from '../src/lib/imports';
import { overview,listPeople,profile,addNote,reviewList,decideReview,reverseMerge,deletePerson } from '../src/lib/people';
import { hashPassword,hashToken } from '../src/lib/security';
import { authenticate,checkOrigin,login } from '../src/lib/auth';
import { GET,POST,DELETE } from '../src/app/api/[...path]/route';
import { suggestMapping } from '../src/lib/normalize';
import { createBackup,restoreBackup } from '../src/lib/backup';
import { acceptLineWebhook,workLineOnce,createTask,setTaskStatus,listTasks } from '../src/lib/line';
import { linkPerson } from '../src/lib/people';
import { createSegment,addManualMembership,removeMembership,intelligenceDashboard,profileSegments } from '../src/lib/intelligence';
test('real Postgres: migrations, import retry, identity decisions, permissions, deletion and recovery', {timeout:180000},async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'go365-test-'));
  const port=55400+Math.floor(Math.random()*500);
  const password=randomBytes(18).toString('hex');
  const pg=new EmbeddedPostgres({databaseDir:path.join(dir,'db'),user:'leadtest',password,port,persistent:true,authMethod:'scram-sha-256',postgresFlags:['-h','127.0.0.1'],onLog:()=>{},onError:()=>{}});
  let started=false;
  try{
    await pg.initialise();await pg.start();started=true;await pg.createDatabase('go365_test');
    process.env.DATABASE_URL=`postgres://leadtest:${password}@127.0.0.1:${port}/go365_test`;
    process.env.STORAGE_DIR=path.join(dir,'uploads');process.env.APP_ORIGIN='http://127.0.0.1:3000';
    await migrate(getDb(),{migrationsFolder:'./drizzle'});await migrate(getDb(),{migrationsFolder:'./drizzle'});
    const sql=getSql();const [tenant]=await sql`insert into tenants(name) values ('GO365 test') returning id`;
    const [admin]=await sql`insert into admins(tenant_id,username,password_hash) values (${tenant.id},'test-owner',${await hashPassword('synthetic-owner-password')}) returning id`;
    const actor={id:admin.id,tenantId:tenant.id,username:'test-owner'};
    const bytes=Buffer.from('customer id,full name,phone,email,agency,trip code,trip name,departure date\r\nC1,สมชาย ใจดี,0810000001,owner@example.test,Demo Agency,T1,Kunming,2026-12-10\r\nC2,มาลี สุขใจ,0810000001,,Demo Agency,,,\r\nC3,Invalid,bad-phone,bad-email,,,,31/02/2026\r\nC4,Unknown Date,,,,T2,No date,\r\n','utf8');
    const result=await upload(actor,'contacts.csv',bytes,'tour-crm');
    assert.equal((await upload(actor,'again.csv',bytes,'tour-crm')).id,result.id);
    const mapping=suggestMapping([['customer id','full name','phone','email','agency','trip code','trip name','departure date']]).mapping;
    const summary=await mapImport(actor,result.id,mapping);assert.equal(summary.valid,3);assert.equal(summary.invalid,1);assert.equal(summary.potentialDuplicates,1);
    assert.equal((await overview(actor)).counts.people,0);
    await confirmImport(actor,result.id);await confirmImport(actor,result.id);
    // Simulate a committed first row followed by a crashed worker, then resume from its durable row state.
    const {processRow}=await import('../src/lib/imports');
    await sql.begin(async tx=>{const [batch]=await tx`select * from import_batches where id=${result.id}`;const [row]=await tx`select * from import_rows where batch_id=${result.id} and status='ready' order by row_number limit 1`;await processRow(tx,actor.tenantId,batch as any,row as any);});
    await workOnce();assert.equal((await importStatus(actor,result.id)).batch.status,'completed');assert.equal(await workOnce(),false);
    assert.equal((await overview(actor)).counts.people,3);const [eventCount]=await sql`select count(*)::int as n from timeline_events`;assert.equal(eventCount.n,3);
    const reviews=await reviewList(actor);assert.equal(reviews.length,1);assert.equal(reviews[0].status,'pending');
    const before=await listPeople(actor,{agency:'Demo Agency'});assert.equal(before.length,2);
    const review=reviews[0];const target=(review.candidate_ids as string[])[0];
    await decideReview(actor,review.id,'merge',target,'Fixture manual identity decision');
    assert.equal((await listPeople(actor,{})).length,2);assert.equal((await profile(actor,target)).contacts.length,2);
    const [merge]=await sql`select id from merges where review_id=${review.id}`;await reverseMerge(actor,merge.id);
    assert.equal((await listPeople(actor,{})).length,3);await decideReview(actor,review.id,'reject',undefined,'Shared agency phone, different people');
    await addNote(actor,target,'Synthetic human note');assert.ok((await profile(actor,target)).events.some(e=>e.kind==='note'));
    const unknown=(await listPeople(actor,{q:'Unknown Date'}))[0];assert.equal((await profile(actor,unknown.id)).events[0].business_date,null);
    // Auth, CSRF, endpoint protection and tenant boundaries.
    await assert.rejects(authenticate(new Request('http://127.0.0.1:3000/api/people')),/sign in/);
    assert.throws(()=>checkOrigin(new Request('http://127.0.0.1:3000/api/people',{method:'POST',headers:{origin:'https://other.test'}})),/origin/);
    const session=await login('test-owner','synthetic-owner-password');const cookie=session.cookie.split(';')[0];
    const request=(url:string,method='GET',body?:unknown)=>new Request('http://127.0.0.1:3000/api/'+url,{method,headers:{cookie,origin:'http://127.0.0.1:3000','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
    const ctx=(...parts:string[])=>({params:Promise.resolve({path:parts})});
    assert.equal((await GET(new Request('http://127.0.0.1:3000/api/people'),ctx('people'))).status,401);
    assert.equal((await POST(new Request('http://127.0.0.1:3000/api/imports',{method:'POST',headers:{origin:'http://127.0.0.1:3000'}}),ctx('imports'))).status,401);
    assert.equal((await DELETE(new Request('http://127.0.0.1:3000/api/people/'+target,{method:'DELETE',headers:{origin:'http://127.0.0.1:3000'}}),ctx('people',target))).status,401);
    const response=await GET(request('people?agency=Demo%20Agency'),ctx('people'));assert.equal(response.status,200);const visible=await response.json();
    const exported=await GET(request('export/people?agency=Demo%20Agency'),ctx('export','people'));assert.equal(exported.status,200);const exportText=await exported.text();assert.equal(exportText.split('\r\n').length-1,visible.length);
    const [other]=await sql`insert into tenants(name) values ('Other test tenant') returning id`;
    const [hidden]=await sql`insert into people(tenant_id,name) values (${other.id},'Invisible person') returning id`;
    assert.equal((await listPeople(actor,{q:'Invisible'})).length,0);await assert.rejects(profile(actor,hidden.id),/not found/);
    await sql`update sessions set expires_at=now()-interval '1 second'`;
    await assert.rejects(authenticate(request('people')),/expired/);
    // Retry a failed job whose completed rows must stay completed.
    await sql`update jobs set status='failed' where batch_id=${result.id}`;await sql`update import_batches set status='failed' where id=${result.id}`;
    await retryImport(actor,result.id);await workOnce();const [afterCount]=await sql`select count(*)::int as n from timeline_events where row_id is not null`;assert.equal(afterCount.n,3);
    // Signed LINE delivery is accepted once, then the worker creates one person, event and reply task.
    const [lineTenant]=await sql`insert into tenants(name) values ('GO365') returning id`;
    process.env.LINE_CHANNEL_SECRET='synthetic-secret';process.env.LINE_DESTINATION_ID='synthetic-destination';
    const event={destination:'synthetic-destination',events:[{webhookEventId:'test-event-1',type:'message',timestamp:Date.now(),source:{type:'user',userId:'synthetic-line-user'},message:{type:'text',text:'สนใจทริปญี่ปุ่น'}}]};
    const raw=Buffer.from(JSON.stringify(event));const signature=createHmac('sha256',process.env.LINE_CHANNEL_SECRET).update(raw).digest('base64');
    await assert.rejects(acceptLineWebhook(raw,'bad-signature'),/signature/);
    assert.equal((await acceptLineWebhook(raw,signature)).accepted,1);
    assert.equal((await acceptLineWebhook(raw,signature)).accepted,0);
    await workLineOnce();assert.equal(await workLineOnce(),false);
    const [lineCount]=await sql`select (select count(*)::int from line_events where tenant_id=${lineTenant.id}) as inbox,(select count(*)::int from tasks where tenant_id=${lineTenant.id}) as tasks,(select count(*)::int from timeline_events where line_event_id is not null) as events`;
    assert.deepEqual([lineCount.inbox,lineCount.tasks,lineCount.events],[1,1,1]);
    const task=await createTask(actor,target,'Call about trip',null);assert.equal((await listTasks(actor)).length,1);
    await setTaskStatus(actor,task.id,'done');assert.equal((await listTasks(actor))[0].status,'done');
    const linked=await linkPerson(actor,unknown.id,target,'Owner confirmed same person');assert.equal((await profile(actor,target)).contacts.length,2);
    await reverseMerge(actor,linked.id);assert.equal((await profile(actor,target)).contacts.length,1);
    const segment=await createSegment(actor,'Kunming interest','People asking specifically about a Kunming trip');
    const membership=await addManualMembership(actor,target,segment.id);assert.equal((await profileSegments(actor,target)).length,1);
    assert.equal((await intelligenceDashboard(actor)).segments[0].members,1);
    assert.equal((await intelligenceDashboard(actor)).stageCounts.find(s=>s.stage==='Booked')?.count,0);
    await removeMembership(actor,membership.id);assert.equal((await profileSegments(actor,target)).length,0);
    process.env.AI_SEGMENT_ENABLED='true';process.env.ANTHROPIC_API_KEY='synthetic-test-key';
    try{await addNote(actor,target,'สนใจคุนหมิง 8 คน');const [queued]=await sql`select count(*)::int as n from segment_runs where tenant_id=${actor.tenantId} and person_id=${target} and status='pending'`;assert.equal(queued.n,1);}finally{delete process.env.AI_SEGMENT_ENABLED;delete process.env.ANTHROPIC_API_KEY;}
    const insightBytes=Buffer.from('full name,d.o.b.,sex,agency,remark,tel.\r\nDemo Birth,1973-04-05,M,QUALITY EXPRESS,ต้องการห้อง DBL,—\r\n');
    const insightUpload=await upload(actor,'insight.csv',insightBytes,'synthetic-insight');
    assert.equal((await upload(actor,'same-insight.csv',insightBytes,'synthetic-insight')).id,insightUpload.id);
    await mapImport(actor,insightUpload.id,suggestMapping([['full name','d.o.b.','sex','agency','remark','tel.']]).mapping);
    await confirmImport(actor,insightUpload.id);await workOnce();
    const insightPerson=(await listPeople(actor,{q:'Demo Birth'}))[0];const insightProfile=await profile(actor,insightPerson.id);
    assert.equal(new Date(insightProfile.person.birth_date).toISOString().slice(0,10),'1973-04-05');assert.equal(insightProfile.person.gender,'male');assert.equal(insightProfile.person.agency_name,'QUALITY EXPRESS');
    assert.equal(insightProfile.events[0].payload.remark,'ต้องการห้อง DBL');
    const renewed=await login('test-owner','synthetic-owner-password');
    const insightExport=await GET(new Request('http://127.0.0.1:3000/api/export/people?q=Demo%20Birth',{headers:{cookie:renewed.cookie.split(';')[0]}}),ctx('export','people'));
    assert.match(await insightExport.text(),/"1973-04-05","male","ต้องการห้อง DBL"/);
    // Seven-day original retention cleanup is independent from successful processing.
    const [retained]=await sql`select file_path from import_batches where id=${result.id}`;
    await sql`update import_batches set expires_at=now()-interval '1 second' where id=${result.id}`;await cleanupExpired();await assert.rejects(access(path.join(process.env.STORAGE_DIR!,retained.file_path)));
    // Transactional snapshot/restore rehearsal on a separate disposable Postgres database.
    // pg_dump/pg_restore instructions are also documented for the production recovery drill.
    const snapshot=await createBackup(sql);
    await pg.createDatabase('go365_restore');const restored=postgres(`postgres://leadtest:${password}@127.0.0.1:${port}/go365_restore`);
    try{const {drizzle}=await import('drizzle-orm/postgres-js');const migrationClient=postgres(`postgres://leadtest:${password}@127.0.0.1:${port}/go365_restore`);try{await migrate(drizzle(migrationClient),{migrationsFolder:'./drizzle'});}finally{await migrationClient.end();}
      await restoreBackup(restored,JSON.parse(JSON.stringify(snapshot)));
      const [restoredPeople]=await restored`select count(*)::int as n from people`;const [restoredEvents]=await restored`select count(*)::int as n from timeline_events`;
      assert.equal(restoredPeople.n,snapshot.tables.people.length);assert.equal(restoredEvents.n,snapshot.tables.timeline_events.length);
      await assert.rejects(restoreBackup(restored,snapshot),/empty database/);
    }finally{await restored.end();}
    const invalidRelated=await upload(actor,'invalid-related.csv',Buffer.from('customer id,full name,phone\nC1,สมชาย ใจดี,invalid-phone\n'),'tour-crm');
    await mapImport(actor,invalidRelated.id,suggestMapping([['customer id','full name','phone']]).mapping);
    await deletePerson(actor,target);await assert.rejects(profile(actor,target),/not found/);
    const [deleted]=await sql`select count(*)::int as n from import_rows where person_id is null and status='deleted' and data='{}'::jsonb`;assert.equal(deleted.n,2);
    const [scrubbedBatch]=await sql`select file_path from import_batches where id=${invalidRelated.id}`;assert.equal(scrubbedBatch.file_path,null);
    const [notes]=await sql`select count(*)::int as n from timeline_events where payload->>'body'='Synthetic human note'`;assert.equal(notes.n,0);
    console.log('Integration evidence: migration rerun, crashed-row resume, duplicate review/reversal, API auth/tenant isolation, CSV parity, retention cleanup, isolated restore and deletion passed.');
  }catch(e){console.error('Integration failure:',e);throw e;}finally{
    await closeDb();
    if(started){if(process.platform==='win32')await promisify(execFile)(path.resolve('node_modules/@embedded-postgres/windows-x64/native/bin/pg_ctl.exe'),['-D',path.join(dir,'db'),'-m','fast','-w','stop'],{windowsHide:true});else await pg.stop();}
  }
});
