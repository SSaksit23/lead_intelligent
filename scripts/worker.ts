import { setTimeout } from 'node:timers/promises';
import { workOnce,cleanupExpired } from '../src/lib/imports';
import { closeDb } from '../src/db';
import { workLineOnce } from '../src/lib/line';
import { workSegmentOnce } from '../src/lib/intelligence';
let stopping=false;process.on('SIGINT',()=>{stopping=true;});process.on('SIGTERM',()=>{stopping=true;});
console.log('GO365 import worker started.');
let nextCleanup=0;
try{while(!stopping){try{
  if(Date.now()>nextCleanup){await cleanupExpired();nextCleanup=Date.now()+60_000;}
  const worked=await workOnce();const lineWorked=await workLineOnce();const segmentWorked=await workSegmentOnce();if(!worked&&!lineWorked&&!segmentWorked)await setTimeout(1500);
}catch{console.error('Worker connection/cleanup failed; retrying in 5 seconds.');await setTimeout(5000);}}}finally{await closeDb();}
