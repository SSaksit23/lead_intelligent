import { getSql, type Tx } from '../db';
import { AppError,type Actor } from './contracts';
import { removeStored } from './storage';
import { openAiConfigured } from './openai';
export type Filters={q?:string;agency?:string;source?:string};
export async function listPeople(actor:Actor,filters:Filters={}){
  const sql=getSql();const q='%'+(filters.q||'').replace(/[\\%_]/g,'\\$&')+'%';const agency='%'+(filters.agency||'').replace(/[\\%_]/g,'\\$&')+'%';
  // The same query drives the screen and CSV export; merged children contribute their contact/source fields.
  return sql`select p.id,p.tenant_id,p.name,p.phone,p.email,p.agency,p.agency_name,p.birth_date::text as birth_date,p.gender,p.merged_into,p.created_at, (select count(*)::int from people c where c.tenant_id=p.tenant_id and c.merged_into=p.id) as merged_count,
    (select e.payload->>'remark' from timeline_events e join people c on c.id=e.person_id and c.tenant_id=p.tenant_id where e.tenant_id=p.tenant_id and (c.id=p.id or c.merged_into=p.id) and nullif(e.payload->>'remark','') is not null order by e.created_at desc,e.id desc limit 1) as latest_remark
    from people p where p.tenant_id=${actor.tenantId} and p.merged_into is null
    and exists (select 1 from people c where c.tenant_id=p.tenant_id and (c.id=p.id or c.merged_into=p.id)
      and (c.name ilike ${q} or coalesce(c.phone,'') ilike ${q} or coalesce(c.email,'') ilike ${q}) and (coalesce(c.agency,'') ilike ${agency} or coalesce(c.agency_name,'') ilike ${agency}))
    and (${filters.source||''}='' or exists(select 1 from source_links s join people c on c.id=s.person_id where s.tenant_id=p.tenant_id and (c.id=p.id or c.merged_into=p.id) and s.source=${filters.source||''}))
    order by p.name,p.id`;
}
export async function memberIds(tx:Tx,actor:Actor,id:string){
  const [person]=await tx`select * from people where tenant_id=${actor.tenantId} and id=${id}`;
  if(!person)throw new AppError(404,'Person not found.');
  const root=person.merged_into||person.id;
  const members=await tx`select id from people where tenant_id=${actor.tenantId} and (id=${root} or merged_into=${root}) order by id`;
  return {person,root,ids:members.map(p=>p.id as string)};
}
export async function profile(actor:Actor,id:string){return getSql().begin(async tx=>{
  const {person,root,ids}=await memberIds(tx,actor,id);
  const [canonical]=await tx`select * from people where id=${root} and tenant_id=${actor.tenantId}`;
  const contacts=await tx`select * from people where tenant_id=${actor.tenantId} and id in ${tx(ids)}`;
  const events=await tx`select e.*,a.username as author from timeline_events e left join admins a on a.id=(e.payload->>'authorId')::uuid where e.tenant_id=${actor.tenantId} and e.person_id in ${tx(ids)} order by e.business_date desc nulls last,e.created_at desc,e.id`;
  const history=await tx`select distinct t.* from trips t join participation p on p.trip_id=t.id where p.tenant_id=${actor.tenantId} and p.person_id in ${tx(ids)} order by t.departure_date desc nulls last,t.name`;
  const sources=await tx`select s.*,b.filename,r.row_number from source_links s join import_rows r on r.id=s.row_id join import_batches b on b.id=r.batch_id where s.tenant_id=${actor.tenantId} and s.person_id in ${tx(ids)}`;
  const merges=await tx`select * from merges where tenant_id=${actor.tenantId} and (source_id in ${tx(ids)} or target_id in ${tx(ids)}) order by created_at desc`;
  const tasks=await tx`select * from tasks where tenant_id=${actor.tenantId} and person_id in ${tx(ids)} order by (status='open') desc,due_at asc nulls last,created_at desc`;
  return {person:canonical,requestedPerson:person,contacts,events,trips:history,sources,merges,tasks};
});}
export async function addNote(actor:Actor,id:string,body:string){
  if(!body.trim()||body.length>5000)throw new AppError(400,'Note must contain 1–5,000 characters.');
  return getSql().begin(async tx=>{
    await tx`select pg_advisory_xact_lock(hashtext(${actor.tenantId}))`;
    const {root}=await memberIds(tx,actor,id);
    const [note]=await tx`insert into timeline_events (tenant_id,person_id,kind,business_date,payload) values (${actor.tenantId},${root},'note',${new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())},${tx.json({version:1,body:body.trim(),authorId:actor.id})}) returning *`;
    if(openAiConfigured()){const [active]=await tx`select id from segment_runs where tenant_id=${actor.tenantId} and person_id=${root} and status='pending' limit 1`;if(!active)await tx`insert into segment_runs (tenant_id,person_id) select ${actor.tenantId},${root} where exists(select 1 from segments where tenant_id=${actor.tenantId} and active)`;}
    await tx`insert into audit (tenant_id,actor_id,action,subject_id) values (${actor.tenantId},${actor.id},'note_created',${note.id})`;
    return note;
  });
}
export async function reviewList(actor:Actor){return getSql()`select r.*,p.name,p.phone,p.email,
  coalesce((select json_agg(json_build_object('id',c.id,'name',c.name,'phone',c.phone,'email',c.email,'mergedInto',c.merged_into)) from people c where c.tenant_id=r.tenant_id and c.id in (select jsonb_array_elements_text(r.candidate_ids)::uuid)), '[]') as candidates
  from reviews r join people p on p.id=r.person_id where r.tenant_id=${actor.tenantId} order by (r.status='pending') desc,r.created_at desc`;
}
export async function decideReview(actor:Actor,reviewId:string,action:'merge'|'reject',targetId:string|undefined,reason:string){
  if(!reason.trim()||reason.length>1000)throw new AppError(400,'Record a decision reason (1–1,000 characters).');
  return getSql().begin(async tx=>{
    await tx`select pg_advisory_xact_lock(hashtext(${actor.tenantId}))`;
    const [review]=await tx`select * from reviews where id=${reviewId} and tenant_id=${actor.tenantId} for update`;
    if(!review)throw new AppError(404,'Review not found.');
    if(review.status!=='pending')throw new AppError(409,'This review was already decided.');
    if(action==='merge'){
      if(!targetId||!(review.candidate_ids as string[]).includes(targetId))throw new AppError(400,'Choose one of the review candidates.');
      const {person:source}=await memberIds(tx,actor,review.person_id);const {root:target}=await memberIds(tx,actor,targetId);
      const [children]=await tx`select count(*)::int as n from people where tenant_id=${actor.tenantId} and merged_into=${source.id}`;
      if(source.merged_into||source.id===target||children.n)throw new AppError(409,'Reverse existing merges before merging this source.');
      await tx`update people set merged_into=${target} where id=${source.id} and tenant_id=${actor.tenantId}`;
      await tx`insert into merges (tenant_id,source_id,target_id,review_id,reason,actor_id) values (${actor.tenantId},${source.id},${target},${review.id},${reason},${actor.id})`;
    }
    await tx`update reviews set status=${action==='merge'?'merged':'rejected'},decision=${reason} where id=${reviewId} and tenant_id=${actor.tenantId}`;
    await tx`insert into audit (tenant_id,actor_id,action,subject_id) values (${actor.tenantId},${actor.id},${'review_'+action},${reviewId})`;
  });
}
export async function reverseMerge(actor:Actor,mergeId:string){return getSql().begin(async tx=>{
  await tx`select pg_advisory_xact_lock(hashtext(${actor.tenantId}))`;
  const [merge]=await tx`select * from merges where id=${mergeId} and tenant_id=${actor.tenantId} for update`;
  if(!merge||merge.reversed)throw new AppError(409,'Merge unavailable or already reversed.');
  await tx`update people set merged_into=null where id=${merge.source_id} and tenant_id=${actor.tenantId}`;
  await tx`update merges set reversed=true where id=${mergeId} and tenant_id=${actor.tenantId}`;
  if(merge.review_id)await tx`update reviews set status='pending',decision=null where id=${merge.review_id} and tenant_id=${actor.tenantId}`;
  await tx`insert into audit (tenant_id,actor_id,action,subject_id) values (${actor.tenantId},${actor.id},'merge_reversed',${mergeId})`;
});}
export async function linkPerson(actor:Actor,sourceId:string,targetId:string,reason:string){return getSql().begin(async tx=>{
  await tx`select pg_advisory_xact_lock(hashtext(${actor.tenantId}))`;
  const {person:source}=await memberIds(tx,actor,sourceId);const {root:target}=await memberIds(tx,actor,targetId);
  const [children]=await tx`select count(*)::int as n from people where tenant_id=${actor.tenantId} and merged_into=${source.id}`;
  if(source.merged_into||source.id===target||children.n)throw new AppError(409,'Reverse existing merges before linking this profile.');
  const [merge]=await tx`insert into merges (tenant_id,source_id,target_id,reason,actor_id) values (${actor.tenantId},${source.id},${target},${reason.trim()},${actor.id}) returning *`;
  await tx`update people set merged_into=${target} where tenant_id=${actor.tenantId} and id=${source.id}`;
  await tx`insert into audit (tenant_id,actor_id,action,subject_id) values (${actor.tenantId},${actor.id},'person_linked',${merge.id})`;
  return merge;
});}
export async function deletePerson(actor:Actor,id:string){
  // Remove file first under the tenant lock. Any failure aborts deletion rather than claiming the original was erased.
  await getSql().begin(async tx=>{
    await tx`select pg_advisory_xact_lock(hashtext(${actor.tenantId}))`;
    const {ids}=await memberIds(tx,actor,id);
    const affected=await tx`select r.id,r.batch_id from import_rows r join import_batches b on b.id=r.batch_id where r.tenant_id=${actor.tenantId} and (r.person_id in ${tx(ids)} or (r.person_id is null and exists(select 1 from source_links s where s.tenant_id=${actor.tenantId} and s.person_id in ${tx(ids)} and s.source=b.source and s.external_id=r.data->>'sourceId'))) `;
    const rowIds=affected.map(r=>r.id as string);const batchIds=[...new Set(affected.map(r=>r.batch_id as string))];
    const related=batchIds.length?await tx`select id,file_path from import_batches where tenant_id=${actor.tenantId} and id in ${tx(batchIds)}`:[];
    for(const batch of related){
      // Do not let pending processing recreate a deleted profile from this retained file.
      const [job]=await tx`select status from jobs where batch_id=${batch.id} and tenant_id=${actor.tenantId}`;
      if(job&&job.status!=='completed')throw new AppError(409,'Finish or resolve the active import before deleting this profile.');
    }
    for(const batch of related){
      if(batch.file_path)await removeStored(batch.file_path);
      await tx`update import_batches set file_path=null where id=${batch.id} and tenant_id=${actor.tenantId}`;
    }
    await tx`delete from reviews where tenant_id=${actor.tenantId} and (person_id in ${tx(ids)} or exists(select 1 from jsonb_array_elements_text(candidate_ids) x where x::uuid in ${tx(ids)}))`;
    await tx`delete from merges where tenant_id=${actor.tenantId} and (source_id in ${tx(ids)} or target_id in ${tx(ids)})`;
    await tx`delete from audit where tenant_id=${actor.tenantId} and subject_id in ${tx(ids)}`;
    await tx`delete from tasks where tenant_id=${actor.tenantId} and person_id in ${tx(ids)}`;
    await tx`delete from segment_proposals where tenant_id=${actor.tenantId} and person_id in ${tx(ids)}`;
    await tx`delete from segment_memberships where tenant_id=${actor.tenantId} and person_id in ${tx(ids)}`;
    await tx`delete from segment_runs where tenant_id=${actor.tenantId} and person_id in ${tx(ids)}`;
    await tx`delete from timeline_events where tenant_id=${actor.tenantId} and person_id in ${tx(ids)}`;
    await tx`delete from line_events where tenant_id=${actor.tenantId} and person_id in ${tx(ids)}`;
    // Search/export audit metadata may contain the deleted person's name or contact filters.
    await tx`update audit set details='{}' where tenant_id=${actor.tenantId} and action='people_exported'`;
    if(rowIds.length)await tx`update import_rows set data='{}',errors='[]',candidate_ids='[]',status='deleted',person_id=null where tenant_id=${actor.tenantId} and id in ${tx(rowIds)}`;
    for(const batchId of batchIds)await tx`update import_batches set summary=summary||jsonb_build_object('valid',(select count(*)::int from import_rows where batch_id=${batchId} and status in ('ready','processed')),'processed',(select count(*)::int from import_rows where batch_id=${batchId} and status='processed'),'invalid',(select count(*)::int from import_rows where batch_id=${batchId} and status='invalid'),'deleted',(select count(*)::int from import_rows where batch_id=${batchId} and status='deleted')) where tenant_id=${actor.tenantId} and id=${batchId}`;
    // Preview candidate references must not retain a deleted identifier.
    await tx`update import_rows set candidate_ids=coalesce((select jsonb_agg(v) from jsonb_array_elements_text(candidate_ids) v where v::uuid not in ${tx(ids)}),'[]'::jsonb) where tenant_id=${actor.tenantId}`;
    await tx`delete from people where tenant_id=${actor.tenantId} and id in ${tx(ids)}`;
    await tx`delete from trips where tenant_id=${actor.tenantId} and not exists(select 1 from participation p where p.trip_id=trips.id)`;
    await tx`insert into audit (tenant_id,actor_id,action,details) values (${actor.tenantId},${actor.id},'person_deleted',${tx.json({count:ids.length})})`;
  });
}
export async function overview(actor:Actor){const sql=getSql();
  const [counts]=await sql`select (select count(*)::int from people where tenant_id=${actor.tenantId} and merged_into is null) as people,(select count(*)::int from trips where tenant_id=${actor.tenantId}) as trips,(select count(*)::int from reviews where tenant_id=${actor.tenantId} and status='pending') as pending,(select count(*)::int from import_rows where tenant_id=${actor.tenantId} and status='invalid') as rejected,(select count(*)::int from tasks where tenant_id=${actor.tenantId} and status='open') as open_tasks`;
  const batches=await sql`select id,filename,source,status,summary,error,created_at from import_batches where tenant_id=${actor.tenantId} order by created_at desc limit 10`;
  return {counts,batches};
}
