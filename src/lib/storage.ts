import path from 'node:path';
import { mkdir,writeFile,readFile,unlink } from 'node:fs/promises';
const root=()=>path.resolve(process.env.STORAGE_DIR||'./storage');
function safe(name:string){if(!/^[a-f0-9-]{36}\.upload$/.test(name))throw new Error('Invalid storage key');return path.join(root(),name);}
export async function store(id:string,bytes:Buffer){await mkdir(root(),{recursive:true,mode:0o700});const name=id+'.upload';await writeFile(safe(name),bytes,{mode:0o600,flag:'wx'});return name;}
export async function readStored(name:string){return readFile(safe(name));}
export async function removeStored(name:string){try{await unlink(safe(name));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}
