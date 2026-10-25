import { z } from 'zod';
import { authenticate,checkOrigin,login,logout } from '../../../lib/auth';
import { AppError } from '../../../lib/contracts';
import { getSql } from '../../../db';
import { upload,importStatus,mapImport,confirmImport,retryImport,importErrors } from '../../../lib/imports';
import { overview,listPeople,profile,addNote,reviewList,decideReview,reverseMerge,deletePerson,linkPerson } from '../../../lib/people';
import { csv } from '../../../lib/csv';
import { MAX_BYTES } from '../../../lib/spreadsheet';
import { createTask,listTasks,setTaskStatus } from '../../../lib/line';
import { intelligenceDashboard,listSegments,createSegment,requestSegmentRun,decideSegmentProposal,addManualMembership,removeMembership,profileSegments,funnelRows } from '../../../lib/intelligence';
import { customerGraph } from '../../../lib/graph';
import { previewKnn,discoverSegments } from '../../../lib/knn';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const uuid=z.string().uuid();
const id=(value:string)=>uuid.parse(value);
const json=(data:unknown,status=200,headers:Record<string,string>={})=>Response.json(data,{status,headers:{'Cache-Control':'no-store',...headers}});
async function body(request:Request){if(Number(request.headers.get('content-length')||0)>64*1024)throw new AppError(413,'Request too large.');return request.json();}
async function handle(request:Request,context:{params:Promise<{path:string[]}>}){
  try{
    const {path}=await context.params;const method=request.method;const [resource,key,action]=path;
    if(path.length>3)throw new AppError(404,'Endpoint not found.');
    if(method!=='GET')checkOrigin(request);
    if(resource==='auth'&&key==='login'&&method==='POST'){
      const input=z.object({username:z.string().min(1).max(100),password:z.string().min(1).max(256)}).parse(await body(request));
      const result=await login(input.username,input.password);return json(result.user,200,{'Set-Cookie':result.cookie});
    }
    const actor=await authenticate(request);
    if(resource==='auth'&&key==='me'&&method==='GET')return json({username:actor.username,tenant:'GO365'});
    if(resource==='auth'&&key==='logout'&&method==='POST')return json({ok:true},200,{'Set-Cookie':await logout(request)});
    if(resource==='overview'&&method==='GET')return json(await overview(actor));
    if(resource==='dashboard'&&method==='GET')return json(await intelligenceDashboard(actor));
    if(resource==='segments'){
      if(!key&&method==='GET')return json(await listSegments(actor));
      if(!key&&method==='POST'){const input=z.object({name:z.string().trim().min(2).max(100),definition:z.string().trim().min(10).max(2000)}).parse(await body(request));return json(await createSegment(actor,input.name,input.definition),201);}
      if(key==='discover'&&method==='GET')return json(await previewKnn(actor));
      if(key==='discover'&&method==='POST')return json(await discoverSegments(actor),201);
      if(key&&action==='decision'&&method==='POST'){id(key);const input=z.object({decision:z.enum(['approve','reject'])}).parse(await body(request));return json(await decideSegmentProposal(actor,key,input.decision));}
    }
    if(resource==='memberships'&&key&&method==='DELETE'){id(key);return json(await removeMembership(actor,key));}
    if(resource==='tasks'){
      if(!key&&method==='GET')return json(await listTasks(actor));
      if(!key&&method==='POST'){const input=z.object({personId:uuid,title:z.string().trim().min(1).max(500),dueAt:z.iso.datetime({offset:true}).nullable().optional()}).parse(await body(request));return json(await createTask(actor,input.personId,input.title,input.dueAt||null),201);}
      if(key&&method==='POST'){id(key);const input=z.object({status:z.enum(['open','done'])}).parse(await body(request));return json(await setTaskStatus(actor,key,input.status));}
    }
    if(resource==='imports'){
      if(!key&&method==='GET')return json(await getSql()`select id,filename,source,status,summary,error,created_at from import_batches where tenant_id=${actor.tenantId} order by created_at desc`);
      if(!key&&method==='POST'){
        if(Number(request.headers.get('content-length')||0)>MAX_BYTES+65536)throw new AppError(413,'Maximum upload size is 10 MB.');
        const form=await request.formData();const file=form.get('file');if(!(file instanceof File))throw new AppError(400,'Choose a spreadsheet.');
        if(file.size>MAX_BYTES)throw new AppError(413,'Maximum upload size is 10 MB.');
        return json(await upload(actor,file.name,Buffer.from(await file.arrayBuffer()),String(form.get('source')||'tour-crm')),201);
      }
      if(key){id(key);
        if(action==='graph'&&method==='GET')return json(await customerGraph(actor,key));
        if(!action&&method==='GET')return json(await importStatus(actor,key));
        if(action==='mapping'&&method==='POST')return json(await mapImport(actor,key,await body(request)));
        if(action==='confirm'&&method==='POST')return json(await confirmImport(actor,key));
        if(action==='retry'&&method==='POST'){await retryImport(actor,key);return json({ok:true});}
        if(action==='errors'&&method==='GET')return new Response(await importErrors(actor,key),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="import-errors.csv"','Cache-Control':'no-store'}});
      }
    }
    if(resource==='people'){
      if(!key&&method==='GET'){const u=new URL(request.url);return json(await listPeople(actor,{q:u.searchParams.get('q')||'',agency:u.searchParams.get('agency')||'',source:u.searchParams.get('source')||''}));}
      if(key){id(key);
        if(!action&&method==='GET'){const [person,segments,funnel]=await Promise.all([profile(actor,key),profileSegments(actor,key),funnelRows(actor)]);return json({...person,segments,stage:funnel.find(row=>row.id===person.person.id)?.stage||'Aware'});}
        if(!action&&method==='DELETE'){
          const input=z.object({confirm:z.literal('DELETE')}).parse(await body(request));void input;
          await deletePerson(actor,key);return json({ok:true});
        }
        if(action==='notes'&&method==='POST'){const input=z.object({body:z.string().min(1).max(5000)}).parse(await body(request));return json(await addNote(actor,key,input.body),201);}
        if(action==='link'&&method==='POST'){const input=z.object({targetId:uuid,reason:z.string().trim().min(1).max(1000)}).parse(await body(request));return json(await linkPerson(actor,key,input.targetId,input.reason));}
        if(action==='segment-run'&&method==='POST')return json(await requestSegmentRun(actor,key),202);
        if(action==='segments'&&method==='POST'){const input=z.object({segmentId:uuid}).parse(await body(request));return json(await addManualMembership(actor,key,input.segmentId),201);}
      }
    }
    if(resource==='reviews'){
      if(!key&&method==='GET')return json(await reviewList(actor));
      if(key&&method==='POST'){id(key);const input=z.object({action:z.enum(['merge','reject']),targetId:z.string().uuid().optional(),reason:z.string().min(1).max(1000)}).parse(await body(request));await decideReview(actor,key,input.action,input.targetId,input.reason);return json({ok:true});}
    }
    if(resource==='merges'&&key&&action==='reverse'&&method==='POST'){id(key);await reverseMerge(actor,key);return json({ok:true});}
    if(resource==='export'&&key==='people'&&method==='GET'){
      const u=new URL(request.url);const filters={q:u.searchParams.get('q')||'',agency:u.searchParams.get('agency')||'',source:u.searchParams.get('source')||''};const rows=await listPeople(actor,filters);
      await getSql()`insert into audit (tenant_id,actor_id,action,details) values (${actor.tenantId},${actor.id},'people_exported',${getSql().json({filters,rowCount:rows.length})})`;
      return new Response(csv(['person_id','name','phone','email','agency_name','birth_date','gender','latest_remark'],rows.map(p=>[p.id,p.name,p.phone,p.email,p.agency_name||p.agency,p.birth_date,p.gender,p.latest_remark])),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="go365-people.csv"','Cache-Control':'no-store'}});
    }
    throw new AppError(404,'Endpoint not found.');
  }catch(error){
    if(error instanceof AppError)return json({error:error.message},error.status);
    if(error instanceof z.ZodError)return json({error:'Invalid input / ข้อมูลไม่ถูกต้อง',issues:error.issues.map(i=>({path:i.path.join('.'),message:i.message}))},400);
    if(error instanceof SyntaxError)return json({error:'Invalid request body.'},400);
    console.error('Request failed:',error instanceof Error?error.name:'unknown');
    return json({error:'Service unavailable. Check database configuration and worker status / ตรวจสอบฐานข้อมูลและ worker'},503);
  }
}
export {handle as GET,handle as POST,handle as DELETE};
