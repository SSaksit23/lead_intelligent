import { createHmac, timingSafeEqual } from 'node:crypto';
import { getSql } from '../db';
import { AppError, type Actor } from './contracts';
import { memberIds } from './people';
import { openAiConfigured } from './openai';

type LineEvent = {webhookEventId?:string;type?:string;timestamp?:number;source?:{type?:string;userId?:string};message?:{type?:string;text?:string}};
export function verifyLineSignature(raw:Buffer,signature:string|null,secret:string){
  if(!signature||!secret)return false;
  const expected=createHmac('sha256',secret).update(raw).digest();
  let received:Buffer;
  try{received=Buffer.from(signature,'base64');}catch{return false;}
  return received.length===expected.length&&timingSafeEqual(received,expected);
}
export async function acceptLineWebhook(raw:Buffer,signature:string|null){
  const secret=process.env.LINE_CHANNEL_SECRET;const destination=process.env.LINE_DESTINATION_ID;
  if(!secret||!destination)throw new AppError(503,'LINE intake is not configured.');
  if(raw.length>1024*1024)throw new AppError(413,'Webhook too large.');
  if(!verifyLineSignature(raw,signature,secret))throw new AppError(401,'Invalid LINE signature.');
  let payload:{destination?:string;events?:LineEvent[]};
  try{payload=JSON.parse(raw.toString('utf8'));}catch{throw new AppError(400,'Invalid webhook JSON.');}
  if(payload.destination!==destination||!Array.isArray(payload.events)||payload.events.length>100)throw new AppError(400,'Invalid webhook destination or events.');
  const sql=getSql();const [tenant]=await sql`select id from tenants where name='GO365' order by id limit 1`;
  if(!tenant)throw new AppError(503,'GO365 tenant is not configured.');
  const tenantId=tenant.id as string;let accepted=0;
  for(const event of payload.events){
    if(!event.webhookEventId||!event.source?.userId||event.source.type!=='user'||typeof event.timestamp!=='number'||!Number.isSafeInteger(event.timestamp)||!event.type)continue;
    const kind=event.type==='message'&&event.message?.type==='text'?'message':event.type;
    if(!['message','follow','unfollow','postback'].includes(kind))continue;
    const message=kind==='message'?event.message?.text?.slice(0,5000)||null:null;
    const [inserted]=await sql`insert into line_events (tenant_id,destination,event_id,source_user_id,kind,message,occurred_at)
      values (${tenantId},${destination},${event.webhookEventId},${event.source.userId},${kind},${message},${new Date(event.timestamp)})
      on conflict (tenant_id,destination,event_id) do nothing returning id`;
    if(inserted)accepted++;
  }
  return {accepted};
}
export async function workLineOnce(){
  const sql=getSql();
  const [event]=await sql`update line_events set status='processing',attempts=attempts+1,locked_at=now(),last_error=null where id=(select id from line_events where status='pending' or (status='failed' and (locked_at is null or locked_at<now()-interval '30 seconds')) or (status='processing' and locked_at<now()-interval '5 minutes') order by created_at,id for update skip locked limit 1) returning *`;
  if(!event)return false;
  try{await sql.begin(async tx=>{
    await tx`select pg_advisory_xact_lock(hashtext(${event.tenant_id}))`;
    const value=`${event.destination}:${event.source_user_id}`;
    const linked=await tx`select p.id,p.merged_into from identities i join people p on p.id=i.person_id where i.tenant_id=${event.tenant_id} and i.kind='line_user_id' and i.value=${value} order by p.created_at limit 2`;
    let personId:string;
    if(linked.length){personId=linked[0].id;}
    else{
      const [created]=await tx`insert into people (tenant_id,name) values (${event.tenant_id},${'LINE contact · '+String(event.source_user_id).slice(-6)}) returning id`;
      personId=created.id;
      await tx`insert into identities (tenant_id,person_id,kind,value) values (${event.tenant_id},${personId},'line_user_id',${value})`;
    }
    await tx`update line_events set person_id=${personId} where id=${event.id}`;
    await tx`insert into timeline_events (tenant_id,person_id,line_event_id,kind,business_date,payload) values (${event.tenant_id},${personId},${event.id},${'line_'+event.kind},${new Date(event.occurred_at).toISOString()},${tx.json({version:1,source:'LINE',lineEventId:event.id,body:event.message})}) on conflict (line_event_id) do nothing`;
    if(event.kind==='message'&&event.message)await tx`insert into tasks (tenant_id,person_id,line_event_id,title) values (${event.tenant_id},${personId},${event.id},${'Reply on LINE: '+String(event.message).slice(0,140)}) on conflict (line_event_id) do nothing`;
    if(event.kind==='message'&&event.message&&openAiConfigured()){
      const [root]=await tx`select coalesce(merged_into,id) as id from people where id=${personId}`;
      const [active]=await tx`select id from segment_runs where tenant_id=${event.tenant_id} and person_id=${root.id} and status='pending' limit 1`;
      if(!active)await tx`insert into segment_runs (tenant_id,person_id) select ${event.tenant_id},${root.id} where exists(select 1 from segments where tenant_id=${event.tenant_id} and active)`;
    }
    await tx`update line_events set status='completed',locked_at=null,last_error=null where id=${event.id}`;
  });}catch(error){await sql`update line_events set status='failed',locked_at=now(),last_error=${error instanceof Error?error.message.slice(0,1000):'Unknown error'} where id=${event.id}`;}
  return true;
}
export async function listTasks(actor:Actor){return getSql()`select t.*,p.name as person_name from tasks t join people p on p.id=t.person_id where t.tenant_id=${actor.tenantId} order by (t.status='open') desc,t.due_at asc nulls last,t.created_at desc limit 500`;}
export async function createTask(actor:Actor,personId:string,title:string,dueAt:string|null){return getSql().begin(async tx=>{
  const {root}=await memberIds(tx,actor,personId);
  const [task]=await tx`insert into tasks (tenant_id,person_id,title,due_at) values (${actor.tenantId},${root},${title.trim()},${dueAt?new Date(dueAt):null}) returning *`;
  await tx`insert into audit (tenant_id,actor_id,action,subject_id) values (${actor.tenantId},${actor.id},'task_created',${task.id})`;
  return task;
});}
export async function setTaskStatus(actor:Actor,taskId:string,status:'open'|'done'){
  const sql=getSql();const [task]=await sql`update tasks set status=${status},completed_at=${status==='done'?new Date():null} where tenant_id=${actor.tenantId} and id=${taskId} returning id`;
  if(!task)throw new AppError(404,'Task not found.');
  await sql`insert into audit (tenant_id,actor_id,action,subject_id) values (${actor.tenantId},${actor.id},${'task_'+status},${taskId})`;
  return {ok:true};
}
