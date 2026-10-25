import type postgres from 'postgres';
import { z } from 'zod';
const tables=['tenants','admins','people','import_batches','import_rows','jobs','trips','identities','line_events','timeline_events','tasks','participation','source_links','reviews','merges','segments','segment_runs','segment_proposals','segment_memberships','audit'] as const;
const Backup=z.object({version:z.literal(1),createdAt:z.string(),tables:z.record(z.string(),z.array(z.record(z.string(),z.unknown())))});
export async function createBackup(sql:postgres.Sql){
  return sql.begin('isolation level repeatable read read only',async tx=>{
    const data:Record<string,Record<string,unknown>[]>={};
    for(const table of tables){data[table]=await tx`select * from ${tx(table)}`;}
    // Original uploads are intentionally short-lived. A recovered DB must not reference files absent on the restore host.
    data.import_batches=data.import_batches.map(row=>({...row,file_path:null}));
    return {version:1 as const,createdAt:new Date().toISOString(),tables:data};
  });
}
export async function restoreBackup(sql:postgres.Sql,input:unknown){
  const backup=Backup.parse(input);
  if(Object.keys(backup.tables).length!==tables.length||tables.some(t=>!backup.tables[t]))throw new Error('Backup table set is incomplete or unsupported.');
  await sql.begin(async tx=>{
    await tx`select pg_advisory_xact_lock(365)`;
    for(const table of tables){const [count]=await tx`select count(*)::int as n from ${tx(table)}`;if(count.n)throw new Error('Restore requires a migrated, empty database.');}
    for(const table of tables)for(const row of backup.tables[table])await tx`insert into ${tx(table)} select * from jsonb_populate_record(null::${tx(table)},${tx.json(row as postgres.JSONValue)}::jsonb)`;
    // Sessions are never restored; processing leases are invalid on a new host.
    await tx`update jobs set status='pending',locked_at=null,locked_by=null where status='processing'`;
    await tx`update line_events set status='pending',locked_at=null where status='processing'`;
    await tx`update segment_runs set status='pending',locked_at=null where status='processing'`;
    await tx`update import_batches set status='queued' where status='processing'`;
  });
}
