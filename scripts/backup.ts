import { mkdir,writeFile,readFile } from 'node:fs/promises';
import path from 'node:path';
import { getSql,closeDb } from '../src/db';
import { createBackup,restoreBackup } from '../src/lib/backup';
const [mode,filename]=process.argv.slice(2);
try{
  if(!filename||!['create','restore'].includes(mode))throw new Error('Usage: npm run backup -- create|restore <private-file.json>');
  if(mode==='create'){await mkdir(path.dirname(path.resolve(filename)),{recursive:true,mode:0o700});await writeFile(filename,JSON.stringify(await createBackup(getSql())),{mode:0o600,flag:'wx'});console.log('Private logical backup created. Protect it as customer data.');}
  else {if(process.env.RESTORE_CONFIRM!=='EMPTY_DATABASE')throw new Error('Set RESTORE_CONFIRM=EMPTY_DATABASE and point DATABASE_URL to an isolated, migrated empty database.');await restoreBackup(getSql(),JSON.parse(await readFile(filename,'utf8')));console.log('Restore completed; original uploads and sessions were not restored.');}
}finally{await closeDb();}
