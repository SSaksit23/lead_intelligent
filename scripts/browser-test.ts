import { chromium,expect } from '@playwright/test';
import EmbeddedPostgres from 'embedded-postgres';
import { mkdtemp,mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn,execFile,type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { getDb,getSql,closeDb } from '../src/db';
import { hashPassword } from '../src/lib/security';
const dir=await mkdtemp(path.join(tmpdir(),'go365-browser-'));const pgPort=55900+Math.floor(Math.random()*100);const webPort=3105;
const password=randomBytes(20).toString('hex');const ownerPassword=randomBytes(20).toString('hex');
const pg=new EmbeddedPostgres({databaseDir:path.join(dir,'db'),user:'leadtest',password,port:pgPort,persistent:true,postgresFlags:['-h','127.0.0.1'],onLog:()=>{},onError:()=>{}});
let web:ChildProcess|undefined,worker:ChildProcess|undefined;let browser;let started=false;
const logs:string[]=[];
try{
  await pg.initialise();await pg.start();started=true;await pg.createDatabase('go365_browser');
  process.env.DATABASE_URL=`postgres://leadtest:${password}@127.0.0.1:${pgPort}/go365_browser`;process.env.STORAGE_DIR=path.join(dir,'uploads');process.env.APP_ORIGIN=`http://127.0.0.1:${webPort}`;process.env.COOKIE_SECURE='false';
  await migrate(getDb(),{migrationsFolder:'./drizzle'});const sql=getSql();const [tenant]=await sql`insert into tenants(name) values ('GO365') returning id`;
  await sql`insert into admins(tenant_id,username,password_hash) values (${tenant.id},'browser-owner',${await hashPassword(ownerPassword)})`;
  const start=(args:string[])=>{const child=spawn(process.execPath,args,{env:{...process.env,NEXT_TELEMETRY_DISABLED:'1'},windowsHide:true,stdio:['ignore','pipe','pipe']});child.stdout?.on('data',b=>logs.push(String(b)));child.stderr?.on('data',b=>logs.push(String(b)));return child;};
  web=start(['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(webPort)]);
  worker=start(['--import','tsx','scripts/worker.ts']);
  const base=process.env.APP_ORIGIN;
  for(let n=0;n<60;n++){try{if((await fetch(base)).ok)break;}catch{}await new Promise(r=>setTimeout(r,500));}
  browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});const browserErrors:string[]=[];page.on('pageerror',e=>browserErrors.push(e.message));
  await page.goto(base);await page.getByRole('button',{name:'EN',exact:true}).click();
  await page.getByLabel('Username',{exact:true}).fill('browser-owner');await page.getByLabel('Password',{exact:true}).fill(ownerPassword);await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Know the people behind every trip'})).toBeVisible();
  await page.getByRole('button',{name:'Imports',exact:true}).click();
  await page.locator('input[type=file]').setInputFiles('samples/go365-synthetic.xlsx');await page.getByRole('button',{name:'Upload & preview'}).click();
  await expect(page.getByRole('button',{name:'Validate mapping'})).toBeVisible();await page.getByRole('button',{name:'Validate mapping'}).click();
  await expect(page.getByRole('button',{name:'Confirm valid rows'})).toBeEnabled();await page.getByRole('button',{name:'Confirm valid rows'}).click();
  await expect(page.locator('.pill.completed').first()).toBeVisible({timeout:20000});
  await page.getByRole('button',{name:'People',exact:true}).click();await expect(page.getByRole('button',{name:'สมชาย ใจดี',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'สมชาย ใจดี',exact:true}).click();await expect(page.getByRole('heading',{name:'สมชาย ใจดี',exact:true})).toBeVisible();
  await page.getByLabel('Note text').fill('Browser acceptance note — ทดสอบ');await page.getByRole('button',{name:'Save note',exact:true}).click();await expect(page.getByText('Browser acceptance note — ทดสอบ',{exact:true})).toBeVisible();
  await mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/profile-desktop.png',fullPage:true});
  await page.getByRole('button',{name:'Duplicate review',exact:true}).click();await expect(page.getByRole('heading',{name:'มาลี สุขใจ',exact:true})).toBeVisible();
  await page.getByLabel('Decision reason').fill('Shared agency phone; confirmed separate people.');await page.getByRole('button',{name:'Keep separate',exact:true}).click();await expect(page.locator('.pill.rejected')).toBeVisible();
  await page.getByRole('button',{name:'Overview',exact:true}).click();await expect(page.getByRole('heading',{name:'3 people, with their history ready to explore'})).toBeVisible();
  await page.screenshot({path:'test-results/overview-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'test-results/overview-mobile.png',fullPage:true});
  assertNoBrowserErrors(browserErrors);
  console.log('Browser acceptance passed: login, Thai/English, XLSX upload/mapping/confirm, durable worker, profile/note, shared-phone review, overview and responsive screenshots.');
}catch(e){console.error('Browser acceptance failed:',e);console.error(logs.slice(-20).join('\n'));process.exitCode=1;}
finally{
  await browser?.close();web?.kill();worker?.kill();await closeDb();
  if(started){if(process.platform==='win32')await promisify(execFile)(path.resolve('node_modules/@embedded-postgres/windows-x64/native/bin/pg_ctl.exe'),['-D',path.join(dir,'db'),'-m','fast','-w','stop'],{windowsHide:true});else await pg.stop();}
}
function assertNoBrowserErrors(errors:string[]){if(errors.length)throw new Error(errors.join('\n'));}
