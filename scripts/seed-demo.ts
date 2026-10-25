import { readFile } from 'node:fs/promises';
import { getSql,closeDb } from '../src/db';
import { upload,mapImport,confirmImport } from '../src/lib/imports';
import { previewWorkbook } from '../src/lib/spreadsheet';

if(process.env.DEMO_SEED!=='true')throw new Error('Set DEMO_SEED=true to load synthetic examples.');
const url=new URL(process.env.DATABASE_URL||'');
if(!['127.0.0.1','localhost'].includes(url.hostname))throw new Error('Demo data may only be loaded into a local database.');

try{
  const [admin]=await getSql()`select a.id,a.tenant_id,a.username from admins a join tenants t on t.id=a.tenant_id where t.name='GO365' limit 1`;
  if(!admin)throw new Error('Create the GO365 owner account before loading examples.');
  const actor={id:admin.id,tenantId:admin.tenant_id,username:admin.username};
  const filename='go365-synthetic.xlsx';
  const bytes=await readFile('samples/'+filename);
  const existing=await upload(actor,filename,bytes,'go365-synthetic-demo');
  if(!existing.existing){
    const mapping=previewWorkbook(bytes,filename)[0].mapping;
    const summary=await mapImport(actor,existing.id,mapping);
    await confirmImport(actor,existing.id);
    console.log(`Demo import queued: ${summary.valid} valid, ${summary.invalid} invalid; shared-phone review will appear after the worker processes it.`);
  }else console.log(`Demo import already exists (${existing.status}); no records were added.`);
}finally{await closeDb();}
