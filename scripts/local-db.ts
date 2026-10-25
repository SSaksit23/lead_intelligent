import EmbeddedPostgres from 'embedded-postgres';
import path from 'node:path';
import { access,mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
if(!process.env.DATABASE_URL)throw new Error('Configure DATABASE_URL in .env.');
const url=new URL(process.env.DATABASE_URL);
if(!['127.0.0.1','localhost'].includes(url.hostname))throw new Error('db:local only runs a local development database.');
const databaseDir=path.resolve('storage/local-postgres');await mkdir(path.dirname(databaseDir),{recursive:true});
const pg=new EmbeddedPostgres({databaseDir,user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),port:Number(url.port||5432),persistent:true,authMethod:'scram-sha-256',postgresFlags:['-h','127.0.0.1']});
try{await access(path.join(databaseDir,'PG_VERSION'));}catch{await pg.initialise();}
await pg.start();
try{await pg.createDatabase(url.pathname.slice(1));}catch(e){if((e as {code?:string}).code!=='42P04')throw e;}
console.log('Local development Postgres ready. Keep this terminal open; Ctrl+C stops it.');
await new Promise<void>(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);});
if(process.platform==='win32')await promisify(execFile)(path.resolve('node_modules/@embedded-postgres/windows-x64/native/bin/pg_ctl.exe'),['-D',databaseDir,'-m','fast','-w','stop'],{windowsHide:true});else await pg.stop();
