import postgres from 'postgres';
import { createHash } from 'node:crypto';
import { getSql, closeDb } from '../src/db';
import { upload, mapImport, confirmImport } from '../src/lib/imports';
import { normalizeAgencyName } from '../src/lib/normalize';
import type { Mapping } from '../src/lib/contracts';

const sourceName='operational-neondb';
const sourceUrl=process.env.OPERATIONAL_DATABASE_URL;
if(!sourceUrl)throw new Error('Set OPERATIONAL_DATABASE_URL to the existing neondb connection for this run.');
if(new URL(sourceUrl).pathname!=='/neondb')throw new Error('Source must be the operational neondb database.');
if(new URL(process.env.DATABASE_URL||'').pathname!=='/go365_leads')throw new Error('Target must be the GO365 leads database.');
if(process.env.OPERATIONAL_SYNC_CONFIRM!=='IMPORT')throw new Error('Set OPERATIONAL_SYNC_CONFIRM=IMPORT to queue the reviewed source mapping.');
const source=postgres(sourceUrl,{max:1,connect_timeout:10});
const target=getSql();
const headings=['sourceId','name','phone','agency','agencyName','birthDate','gender','remark','tripCode','tripName','departureDate'];
const mapping:Mapping={version:2,sheet:0,headerRow:0,columns:Object.fromEntries(headings.map((field,index)=>[String(index),field])) as Mapping['columns']};
const cell=(value:unknown)=>'"'+String(value??'').replace(/"/g,'""')+'"';
try{
  const [admin]=await target`select a.id,a.tenant_id,a.username from admins a join tenants t on t.id=a.tenant_id where t.name='GO365' limit 1`;
  if(!admin)throw new Error('GO365 administrator not found.');
  const actor={id:admin.id as string,tenantId:admin.tenant_id as string,username:admin.username as string};
  // Deliberate allowlist: encrypted passport, citizen ID and passport expiry are never selected.
  const records=await source`select c.id::text as source_id,c.given_name,c.surname,c.given_name_th,c.surname_th,
    c.gender,c.dob::text as birth_date,c.tel,b.group_id::text as group_id,b.agency,b.remark,
    g.tour_code,g.program_name,g.start_date::text as departure_date
    from customers c left join bookings b on b.customer_id=c.id
    left join groups g on g.id=b.group_id order by c.id,b.group_id nulls last`;
  const previous=await target`select r.data->>'sourceId' as source_id,r.data->>'tripCode' as trip_code
    from import_rows r join import_batches b on b.id=r.batch_id
    where b.tenant_id=${actor.tenantId} and b.source=${sourceName} and r.status in ('ready','processed')`;
  const known=new Set(previous.map(r=>`${r.source_id}|${r.trip_code||''}`));
  const rows:string[][]=[];
  for(const record of records){
    const sourceId=String(record.source_id);
    const tripCode=record.group_id?`neondb-group:${record.group_id}`:'';
    const key=`${sourceId}|${tripCode}`;
    if(known.has(key))continue;
    known.add(key);
    const thai=[record.given_name_th,record.surname_th].filter(Boolean).join(' ').trim();
    const english=[record.given_name,record.surname].filter(Boolean).join(' ').trim();
    const agency=String(record.agency||'').trim();
    rows.push([sourceId,thai||english,String(record.tel||''),agency,normalizeAgencyName(agency)||'',String(record.birth_date||''),String(record.gender||''),String(record.remark||''),tripCode,String(record.program_name||record.tour_code||''),String(record.departure_date||'')]);
  }
  if(!rows.length){console.log('No new operational customer or trip records to import.');}
  else{
    const snapshot=Buffer.from('\uFEFF'+[headings,...rows].map(row=>row.map(cell).join(',')).join('\r\n'),'utf8');
    const suffix=createHash('sha256').update(snapshot).digest('hex').slice(0,12);
    const filename=`neondb-customers-${suffix}.csv`;
    const batch=await upload(actor,filename,snapshot,sourceName);
    if(batch.existing)console.log(`Snapshot already exists: ${batch.status}.`);
    else{
      const summary=await mapImport(actor,batch.id,mapping);
      if(summary.invalid)throw new Error(`Import preview has ${summary.invalid} invalid rows; batch ${batch.id} remains unconfirmed for review.`);
      await confirmImport(actor,batch.id);
      console.log(`Queued operational import ${batch.id}: ${summary.valid} valid rows, ${summary.potentialDuplicates} potential duplicate rows. Review duplicate decisions in GO365.`);
    }
  }
}finally{await source.end();await closeDb();}
