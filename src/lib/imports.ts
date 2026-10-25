import { createHash,randomUUID } from 'node:crypto';
import { getSql,type Tx } from '../db';
import { AppError,type Actor,type NormalizedRow,type Mapping } from './contracts';
import { parseMapped,previewWorkbook,MAX_BYTES } from './spreadsheet';
import { store,readStored,removeStored } from './storage';
import { resolveIdentity } from './identity';
import { csv } from './csv';
const hash=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');
export async function candidates(tx:Tx,tenantId:string,source:string,row:NormalizedRow){
  const sourceKey=source+':'+row.sourceId;
  const matches=await tx`select distinct p.id,p.name,p.phone,p.email,
    exists(select 1 from identities i where i.person_id=p.id and i.tenant_id=${tenantId} and i.kind='source' and i.value=${sourceKey} and ${!!row.sourceId}) as source_match
    from people p left join identities i on i.person_id=p.id and i.tenant_id=p.tenant_id
    where p.tenant_id=${tenantId} and (
      (i.kind='source' and i.value=${sourceKey} and ${!!row.sourceId}) or
      (i.kind='phone' and i.value=${row.phone||''} and ${!!row.phone}) or
      (i.kind='email' and i.value=${row.email||''} and ${!!row.email}) or
      lower(p.name)=lower(${row.name})) limit 100`;
  // Resolve existing child identities to their visible canonical person, retaining conflicting alternatives.
  const canonical=new Map<string,{id:string;name:string;phone:string|null;email:string|null;sourceMatch:boolean}>();
  for(const match of matches){const [p]=await tx`select * from people where tenant_id=${tenantId} and id=coalesce((select merged_into from people where id=${match.id} and tenant_id=${tenantId}),${match.id}::uuid)`;
    const prev=canonical.get(p.id);canonical.set(p.id,{id:p.id,name:p.name,phone:p.phone,email:p.email,sourceMatch:!!match.source_match||!!prev?.sourceMatch});
  }
  return resolveIdentity(row,[...canonical.values()]);
}
export async function upload(actor:Actor,filename:string,bytes:Buffer,source:string){
  if(bytes.length>MAX_BYTES)throw new AppError(413,'Maximum upload size is 10 MB.');
  if(!/^[\p{L}\p{N} _.-]{1,80}$/u.test(source))throw new AppError(400,'Source must contain 1–80 letters, numbers, spaces, dots, underscores or hyphens.');
  filename=filename.split(/[\\/]/).pop()!.slice(0,180);
  const sql=getSql();const fileHash=hash(bytes);
  const [existing]=await sql`select id,status from import_batches where tenant_id=${actor.tenantId} and file_hash=${fileHash}`;
  if(existing)return {id:existing.id,status:existing.status,existing:true};
  const sheets=previewWorkbook(bytes,filename);const id=randomUUID();const filePath=await store(id,bytes);
  try{await sql.begin(async tx=>{
    await tx`select pg_advisory_xact_lock(hashtext(${actor.tenantId}))`;
    await tx`insert into import_batches (id,tenant_id,filename,file_hash,file_path,source,expires_at) values (${id},${actor.tenantId},${filename},${fileHash},${filePath},${source},now()+interval '7 days')`;
    await tx`insert into audit (tenant_id,actor_id,action,subject_id) values (${actor.tenantId},${actor.id},'import_uploaded',${id})`;
  });}catch(e){await removeStored(filePath);if((e as {code?:string}).code==='23505'){const [batch]=await sql`select id,status from import_batches where tenant_id=${actor.tenantId} and file_hash=${fileHash}`;return {id:batch.id,status:batch.status,existing:true};}throw e;}
  return {id,status:'preview',existing:false,sheets};
}
export async function importStatus(actor:Actor,id:string){
  const sql=getSql();const [batch]=await sql`select * from import_batches where id=${id} and tenant_id=${actor.tenantId}`;
  if(!batch)throw new AppError(404,'Import not found.');
  const rows=await sql`select id,row_number,data,errors,status,candidate_ids from import_rows where batch_id=${id} and tenant_id=${actor.tenantId} order by row_number limit 200`;
  const [job]=await sql`select status,attempts,last_error from jobs where batch_id=${id} and tenant_id=${actor.tenantId}`;
  const {file_path:_,...publicBatch}=batch;
  let sheets;
  if(batch.status==='preview'&&batch.file_path&&new Date(batch.expires_at)>new Date())sheets=previewWorkbook(await readStored(batch.file_path),batch.filename);
  return {batch:publicBatch,rows,job,sheets};
}
export async function mapImport(actor:Actor,id:string,input:unknown){return getSql().begin(async tx=>{
  await tx`select pg_advisory_xact_lock(hashtext(${actor.tenantId}))`;
  const [batch]=await tx`select * from import_batches where id=${id} and tenant_id=${actor.tenantId} for update`;
  if(!batch)throw new AppError(404,'Import not found.');
  if(batch.status!=='preview')throw new AppError(409,'Confirmed imports cannot be remapped.');
  if(!batch.file_path||new Date(batch.expires_at)<=new Date())throw new AppError(410,'Original file expired. Upload a new export.');
  const {mapping,rows}=parseMapped(await readStored(batch.file_path),batch.filename,input);
  await tx`delete from import_rows where batch_id=${id} and tenant_id=${actor.tenantId}`;
  let valid=0,invalid=0,duplicates=0;const seen=new Set<string>();
  for(const row of rows){
    const resolution=row.errors.length?{candidates:[]}:await candidates(tx,actor.tenantId,batch.source,row.data);
    const keys=[row.data.sourceId&&'s:'+row.data.sourceId,row.data.phone&&'p:'+row.data.phone,row.data.email&&'e:'+row.data.email,'n:'+row.data.name.toLowerCase()].filter(Boolean) as string[];
    const withinFile=keys.some(k=>seen.has(k));keys.forEach(k=>seen.add(k));
    if(row.errors.length)invalid++;else valid++;
    if(resolution.candidates.length||withinFile)duplicates++;
    await tx`insert into import_rows (tenant_id,batch_id,row_number,data,errors,status,candidate_ids) values (${actor.tenantId},${id},${row.rowNumber},${tx.json(row.data)},${tx.json(row.errors)},${row.errors.length?'invalid':'ready'},${tx.json(resolution.candidates)})`;
  }
  const summary={total:rows.length,valid,invalid,potentialDuplicates:duplicates,processed:0};
  await tx`update import_batches set mapping=${tx.json(mapping)},mapping_version=${mapping.version},summary=${tx.json(summary)},error=null where id=${id} and tenant_id=${actor.tenantId}`;
  return summary;
});}
export async function confirmImport(actor:Actor,id:string){return getSql().begin(async tx=>{
  await tx`select pg_advisory_xact_lock(hashtext(${actor.tenantId}))`;
  const [batch]=await tx`select * from import_batches where id=${id} and tenant_id=${actor.tenantId} for update`;
  if(!batch)throw new AppError(404,'Import not found.');
  if(['queued','processing','completed'].includes(batch.status))return {status:batch.status};
  if(batch.status!=='preview')throw new AppError(409,'Use retry for a failed job.');
  if(!batch.summary?.valid)throw new AppError(400,'Preview valid rows before confirmation.');
  await tx`update import_batches set status='queued',confirmed_at=now() where id=${id} and tenant_id=${actor.tenantId}`;
  // The jobs table is the durable outbox, committed with acceptance.
  await tx`insert into jobs (tenant_id,batch_id) values (${actor.tenantId},${id}) on conflict (batch_id) do nothing`;
  await tx`insert into audit (tenant_id,actor_id,action,subject_id) values (${actor.tenantId},${actor.id},'import_confirmed',${id})`;
  return {status:'queued'};
});}
export async function retryImport(actor:Actor,id:string){return getSql().begin(async tx=>{
  await tx`select pg_advisory_xact_lock(hashtext(${actor.tenantId}))`;
  const [job]=await tx`update jobs set status='pending',attempts=0,last_error=null,locked_at=null,locked_by=null where batch_id=${id} and tenant_id=${actor.tenantId} and status='failed' returning id`;
  if(!job)throw new AppError(409,'Only failed imports can be retried.');
  await tx`update import_batches set status='queued',error=null where id=${id} and tenant_id=${actor.tenantId}`;
  await tx`insert into audit (tenant_id,actor_id,action,subject_id) values (${actor.tenantId},${actor.id},'import_retried',${id})`;
});}
export async function importErrors(actor:Actor,id:string){
  const sql=getSql();const [batch]=await sql`select id from import_batches where id=${id} and tenant_id=${actor.tenantId}`;if(!batch)throw new AppError(404,'Import not found.');
  const rows=await sql`select row_number,errors from import_rows where batch_id=${id} and tenant_id=${actor.tenantId} and status='invalid' order by row_number`;
  await sql`insert into audit (tenant_id,actor_id,action,subject_id) values (${actor.tenantId},${actor.id},'import_errors_exported',${id})`;
  return csv(['row','errors'],rows.map(r=>[r.row_number,(r.errors as {message:string}[]).map(e=>e.message).join('; ')]));
}
export async function processRow(tx:Tx,tenantId:string,batch:{id:string;source:string},row:{id:string;row_number:number;data:NormalizedRow}){
  const data=row.data;const resolution=await candidates(tx,tenantId,batch.source,data);
  let personId=resolution.match;
  if(!personId){const [p]=await tx`insert into people (tenant_id,name,phone,email,agency,agency_name,birth_date,gender) values (${tenantId},${data.name},${data.phone},${data.email},${data.agency},${data.agencyName??null},${data.birthDate??null},${data.gender??null}) returning id`;personId=p.id;}
  else await tx`update people set phone=coalesce(phone,${data.phone}),email=coalesce(email,${data.email}),agency=coalesce(agency,${data.agency}),agency_name=coalesce(agency_name,${data.agencyName??null}),birth_date=coalesce(birth_date,${data.birthDate??null}),gender=coalesce(gender,${data.gender??null}) where tenant_id=${tenantId} and id=${personId}`;
  for(const [kind,value] of [['source',data.sourceId?batch.source+':'+data.sourceId:null],['phone',data.phone],['email',data.email]]){
    if(value)await tx`insert into identities (tenant_id,person_id,kind,value) values (${tenantId},${personId},${kind},${value}) on conflict do nothing`;
  }
  if(resolution.candidates.length)await tx`insert into reviews (tenant_id,person_id,candidate_ids,reason) values (${tenantId},${personId},${tx.json(resolution.candidates)},${resolution.reason})`;
  await tx`insert into source_links (tenant_id,person_id,row_id,source,external_id) values (${tenantId},${personId},${row.id},${batch.source},${data.sourceId}) on conflict (row_id) do nothing`;
  let kind='imported';
  if(data.tripCode||data.tripName){
    const tripKey=data.departureDate?hash([batch.source,data.tripCode,data.tripName,data.departureDate].join('|')):hash(batch.id+':'+row.row_number);
    const [trip]=await tx`insert into trips (tenant_id,source_key,name,departure_date) values (${tenantId},${tripKey},${data.tripName||data.tripCode!},${data.departureDate}) on conflict (tenant_id,source_key) do update set source_key=excluded.source_key returning id`;
    await tx`insert into participation (tenant_id,person_id,trip_id,row_id) values (${tenantId},${personId},${trip.id},${row.id}) on conflict (row_id) do nothing`;
    kind='trip_participation';
  }
  await tx`insert into timeline_events (tenant_id,person_id,row_id,kind,business_date,payload) values (${tenantId},${personId},${row.id},${kind},${data.departureDate},${tx.json({version:2,source:batch.source,batchId:batch.id,rowNumber:row.row_number,tripName:data.tripName,tripCode:data.tripCode,birthDate:data.birthDate??null,gender:data.gender??null,agencyName:data.agencyName??null,agencyRaw:data.agency??null,remark:data.remark??null})}) on conflict (row_id) do nothing`;
  await tx`update import_rows set status='processed',person_id=${personId},candidate_ids=${tx.json(resolution.candidates)} where id=${row.id} and tenant_id=${tenantId}`;
}
export async function workOnce(){
  const sql=getSql();const workerId=randomUUID();
  const job=await sql.begin(async tx=>{
    const [j]=await tx`select * from jobs where status='pending' or (status='processing' and locked_at<now()-interval '5 minutes') order by created_at for update skip locked limit 1`;
    if(!j)return null;
    if(j.attempts>=3){await tx`update jobs set status='failed',last_error='Worker lease expired repeatedly' where id=${j.id}`;await tx`update import_batches set status='failed',error='Worker lease expired repeatedly' where id=${j.batch_id}`;return null;}
    await tx`update jobs set status='processing',attempts=attempts+1,locked_at=now(),locked_by=${workerId} where id=${j.id}`;
    await tx`update import_batches set status='processing' where id=${j.batch_id} and tenant_id=${j.tenant_id}`;
    return j;
  });
  if(!job)return false;
  try{
    for(;;){const state=await sql.begin(async tx=>{
      await tx`select pg_advisory_xact_lock(hashtext(${job.tenant_id}))`;
      const [lease]=await tx`select * from jobs where id=${job.id} and locked_by=${workerId} and status='processing' for update`;if(!lease)return 'lost';
      const [batch]=await tx`select id,source from import_batches where id=${job.batch_id} and tenant_id=${job.tenant_id}`;
      const [row]=await tx`select * from import_rows where batch_id=${job.batch_id} and tenant_id=${job.tenant_id} and status='ready' order by row_number for update skip locked limit 1`;
      if(!row){await tx`update jobs set status='completed',locked_by=null,locked_at=null where id=${job.id}`;await tx`update import_batches set status='completed',error=null where id=${job.batch_id} and tenant_id=${job.tenant_id}`;return 'done';}
      await processRow(tx,job.tenant_id,batch as {id:string;source:string},row as {id:string;row_number:number;data:NormalizedRow});
      await tx`update jobs set locked_at=now() where id=${job.id} and locked_by=${workerId}`;
      await tx`update import_batches set summary=jsonb_set(summary,'{processed}',to_jsonb((select count(*)::int from import_rows where batch_id=${job.batch_id} and status='processed'))) where id=${job.batch_id} and tenant_id=${job.tenant_id}`;
      return 'row';
    });if(state!=='row')break;}
  }catch{
    // Do not persist database error strings, which may contain customer values or SQL parameters.
    await sql.begin(async tx=>{await tx`update jobs set status='failed',last_error='Import failed; inspect configuration and retry.',locked_by=null where id=${job.id} and locked_by=${workerId}`;await tx`update import_batches set status='failed',error='Import failed; completed rows are retained. Retry safely.' where id=${job.batch_id} and tenant_id=${job.tenant_id} and status='processing'`;});
  }
  return true;
}
export async function cleanupExpired(){const sql=getSql();
  const expired=await sql`select id,file_path from import_batches where expires_at<now() and file_path is not null`;
  for(const batch of expired){await removeStored(batch.file_path);await sql`update import_batches set file_path=null where id=${batch.id}`;}
  await sql`delete from sessions where expires_at<now()`;
  await sql`delete from login_limits where reset_at<now()`;
}
