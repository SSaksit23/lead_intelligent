import { getSql,closeDb } from '../src/db';
import { workLineOnce } from '../src/lib/line';
if(process.env.DEMO_SEED!=='true')throw new Error('Set DEMO_SEED=true to load synthetic examples.');
const url=new URL(process.env.DATABASE_URL||'');
if(!['127.0.0.1','localhost'].includes(url.hostname))throw new Error('Demo data may only be loaded into a local database.');
try{
  const sql=getSql();const [tenant]=await sql`select id from tenants where name='GO365' limit 1`;
  if(!tenant)throw new Error('Create the GO365 owner account first.');
  const [event]=await sql`insert into line_events (tenant_id,destination,event_id,source_user_id,kind,message,occurred_at)
    values (${tenant.id},'go365-demo-channel','synthetic-line-inquiry-1','synthetic-line-user-1','message','สวัสดีค่ะ สนใจทริปญี่ปุ่นเดือนธันวาคม ขอรายละเอียดได้ไหมคะ',${new Date()})
    on conflict (tenant_id,destination,event_id) do nothing returning id`;
  if(event){await workLineOnce();console.log('Synthetic LINE inquiry and reply task added. This is sample data, not a live LINE connection.');}
  else console.log('Synthetic LINE inquiry already exists; no records were added.');
  await sql`insert into segments (tenant_id,name,definition) values (${tenant.id},'Japan enquiry · demo','Contacts who explicitly ask about Japan trips. Exclude general enquiries without a Japan destination.') on conflict (tenant_id,name) do nothing`;
  const [segment]=await sql`select id from segments where tenant_id=${tenant.id} and name='Japan enquiry · demo'`;
  await sql`insert into segments (tenant_id,name,definition) values (${tenant.id},'Repeat traveller · demo','Contacts with confirmed repeat booking records. Trip participation alone is insufficient.') on conflict (tenant_id,name) do nothing`;
  const [person]=await sql`select person_id from line_events where tenant_id=${tenant.id} and destination='go365-demo-channel' and event_id='synthetic-line-inquiry-1'`;
  if(person?.person_id){
    const [present]=await sql`select id from segment_memberships where tenant_id=${tenant.id} and person_id=${person.person_id} and segment_id=${segment.id} and valid_to is null`;
    if(!present)await sql`insert into segment_memberships (tenant_id,person_id,segment_id,assigned_by,reason,evidence_quote) values (${tenant.id},${person.person_id},${segment.id},'demo','Synthetic example for UI inspection','สนใจทริปญี่ปุ่นเดือนธันวาคม')`;
  }
}finally{await closeDb();}
