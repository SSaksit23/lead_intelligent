import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as XLSX from 'xlsx';
import { suggestMapping,normalizePhone,normalizeDate,normalizeGender,normalizeAgencyName,normalizeRow,validateMapping } from '../src/lib/normalize';
import { csv } from '../src/lib/csv';
import { parseMapped,previewWorkbook } from '../src/lib/spreadsheet';
import { resolveIdentity } from '../src/lib/identity';
import { hashPassword,verifyPassword,readToken,sessionCookie } from '../src/lib/security';
import { createHmac } from 'node:crypto';
import { verifyLineSignature } from '../src/lib/line';
import { redactForModel,verifyDecision } from '../src/lib/intelligence';
import { knnCohorts,type FeatureRow } from '../src/lib/knn';
import { openAiJson } from '../src/lib/openai';

test('OpenAI request uses structured Responses output without storing the response',async()=>{
  const beforeFetch=globalThis.fetch,beforeKey=process.env.OPENAI_API_KEY,beforeEnabled=process.env.AI_SEGMENT_ENABLED;
  process.env.OPENAI_API_KEY='unit-test-key';process.env.AI_SEGMENT_ENABLED='true';
  try{
    globalThis.fetch=async(input,init)=>{assert.equal(String(input),'https://api.openai.com/v1/responses');const body=JSON.parse(String(init?.body));assert.equal(body.store,false);assert.equal(body.text.format.type,'json_schema');assert.equal(body.model,'gpt-5-mini');return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{"ok":true}'}]}]});};
    const result=await openAiJson<{ok:boolean}>('unit_test',{type:'object',properties:{ok:{type:'boolean'}},required:['ok'],additionalProperties:false},'Return JSON',{sample:1});
    assert.deepEqual(result.data,{ok:true});
  }finally{globalThis.fetch=beforeFetch;if(beforeKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=beforeKey;if(beforeEnabled===undefined)delete process.env.AI_SEGMENT_ENABLED;else process.env.AI_SEGMENT_ENABLED=beforeEnabled;}
});

test('mutual kNN keeps distinct trip cohorts separate and ignores sparse profiles',()=>{
  const rows:FeatureRow[]=[...['a','b','c'].map(id=>({id,tripIds:['trip-one'],tripNames:['Tour one'],lastTripDate:'2026-10-26',lineMessages:0,openTasks:0,agencyRecorded:false})),...['d','e','f'].map(id=>({id,tripIds:['trip-two'],tripNames:['Tour two'],lastTripDate:'2026-10-26',lineMessages:0,openTasks:0,agencyRecorded:true})),{id:'g',tripIds:[],tripNames:[],lastTripDate:null,lineMessages:0,openTasks:0,agencyRecorded:false}];
  const groups=knnCohorts(rows);
  assert.deepEqual(groups.map(g=>g.memberIds),[['a','b','c'],['d','e','f']]);
  assert.equal(groups[0].summary.topTrips[0],'Tour one');
});
test('segment evidence gate rejects invented quotes and redacts contact fields',()=>{
  const evidence=[{id:'11111111-1111-4111-8111-111111111111',text:'สนใจคุนหมิง 8 คน'}];
  const segmentId='22222222-2222-4222-8222-222222222222';
  const decision={segmentId,applies:true,confidence:.9,reason:'Specific group inquiry',evidenceQuote:'คุนหมิง 8 คน',evidenceEventId:evidence[0].id};
  assert.equal(verifyDecision(decision,[{id:segmentId}],evidence),true);
  assert.equal(verifyDecision({...decision,evidenceQuote:'พร้อมจ่ายมัดจำ'},[{id:segmentId}],evidence),false);
  assert.equal(redactForModel('Call 081-234-5678 or a@example.com'),'Call [phone] or [email]');
});
test('LINE signature verifies the exact raw body',()=>{
  const raw=Buffer.from('{"events":[],"destination":"test"}');const secret='synthetic-secret';
  const signature=createHmac('sha256',secret).update(raw).digest('base64');
  assert.equal(verifyLineSignature(raw,signature,secret),true);
  assert.equal(verifyLineSignature(Buffer.from(raw.toString()+' '),signature,secret),false);
  assert.equal(verifyLineSignature(raw,'invalid',secret),false);
});
const mapping={version:1 as const,sheet:0,headerRow:0,columns:{'0':'name' as const,'1':'phone' as const,'2':'email' as const,'3':'departureDate' as const}};
test('Thai phone and date normalization preserves unknowns and rejects impossible dates',()=>{
  assert.equal(normalizePhone('081-000-0001'),'+66810000001');assert.equal(normalizePhone('+66 81 000 0001'),'+66810000001');
  assert.equal(normalizePhone(''),null);assert.equal(normalizePhone('call me'),null);
  assert.equal(normalizeDate('25/10/2569'),'2026-10-25');assert.equal(normalizeDate('2026-02-30'),null);assert.equal(normalizeDate(''),null);
});
test('header suggestions require explicit disambiguation and mapping each field once',()=>{
  const result=suggestMapping([['Report'],['ชื่อ','โทรศัพท์','เบอร์โทร','อีเมล']]);assert.equal(result.mapping.headerRow,1);assert.deepEqual(result.ambiguous,['phone']);
  assert.throws(()=>validateMapping({...mapping,columns:{'0':'name','1':'name'}},4),/once/);
  assert.throws(()=>validateMapping({...mapping,columns:{'1':'phone'}},4),/name/);
});
test('passenger-list headers map requested insight fields without ID or passport',()=>{
  const headers=['No.','room','title','name','surname','ชื่อ','นามสกุล','sex','age','d.o.b.','ID','passport','d.o.i.','d.o.e.','tel.','agency','remark อื่นๆ'];
  const suggestion=suggestMapping([['Report'],headers]).mapping;
  assert.equal(suggestion.version,2);assert.equal(suggestion.headerRow,1);
  assert.equal(suggestion.columns['7'],'gender');assert.equal(suggestion.columns['9'],'birthDate');assert.equal(suggestion.columns['15'],'agencyName');assert.equal(suggestion.columns['16'],'remark');
  assert.equal(suggestion.columns['10'],undefined);assert.equal(suggestion.columns['11'],undefined);
  assert.throws(()=>validateMapping({...suggestion,columns:{...suggestion.columns,'10':'sourceId'}},headers.length,headers),/National ID/);
  const row=normalizeRow(['1','','','SUCHAVICH','PONGSIRIVISU','','','M','','1973-04-05','3260100238052','AD1604023','','','—','BK382589 // QUALITY EXPRESS','ต้องการห้อง DBL'],suggestion);
  assert.deepEqual(row.errors,[]);assert.equal(row.data.birthDate,'1973-04-05');assert.equal(row.data.gender,'male');assert.equal(row.data.phone,null);
  assert.equal(row.data.agencyName,'QUALITY EXPRESS');assert.equal(row.data.agency,'BK382589 // QUALITY EXPRESS');assert.equal(row.data.remark,'ต้องการห้อง DBL');
  assert.equal(normalizeAgencyName('BK382589 // QUALITY EXPRESS มี 2 PAX'),'QUALITY EXPRESS');
  assert.equal(normalizeAgencyName('BK382589 // ไม่ทราบชื่อเอเย่นต์'),null);
  assert.equal(normalizeGender('หญิง'),'female');assert.equal(normalizeGender('—'),null);
  const invalid=normalizeRow(['','','','Test','Person','','','X','','1973-02-30','','','','','','',''],suggestion);
  assert.deepEqual(invalid.errors.map(e=>e.field).sort(),['birthDate','gender']);
});
test('malformed rows receive field errors rather than inventing values',()=>{
  const row=normalizeRow(['','not a phone','bad-email','31/02/2026'],mapping);assert.equal(row.errors.length,4);assert.equal(row.data.departureDate,null);
});
test('CSV, XLS and XLSX yield the same normalized Thai records',()=>{
  const rows=[['ชื่อ-นามสกุล','โทรศัพท์','อีเมล','วันเดินทาง'],['สมชาย ใจดี','0810000001','owner@example.test','25/10/2026']];
  for(const format of ['csv','biff8','xlsx'] as const){const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(rows),'People');const bytes=XLSX.write(book,{bookType:format,type:'buffer'});
    const ext=format==='biff8'?'xls':format;const preview=previewWorkbook(bytes,'fixture.'+ext);const parsed=parseMapped(bytes,'fixture.'+ext,preview[0].mapping);
    assert.equal(parsed.rows[0].data.name,'สมชาย ใจดี');assert.equal(parsed.rows[0].data.phone,'+66810000001');assert.equal(parsed.rows[0].errors.length,0);
  }
});
test('CRM regression sample maps first and last names without collecting passports',async()=>{
  const bytes=await readFile('samples/crm-regression-customers.csv');const [sheet]=previewWorkbook(bytes,'customers.csv');const result=parseMapped(bytes,'customers.csv',sheet.mapping);
  assert.equal(result.rows[0].data.name,'SOMCHAI JAIDEE');assert.equal(result.rows[0].data.phone,'+66810000001');assert.equal(result.rows.length,2);
});
test('shared phones, conflicting exact keys and name-only matches require review',()=>{
  const row=normalizeRow(['สมชาย','0810000001','owner@example.test',''],mapping).data;
  const person={id:'a',name:row.name,phone:row.phone,email:null,sourceMatch:false};
  assert.equal(resolveIdentity(row,[person]).match,null);assert.deepEqual(resolveIdentity(row,[person]).candidates,['a']);
  assert.equal(resolveIdentity(row,[{...person,email:row.email}]).match,'a');
  assert.equal(resolveIdentity(row,[{...person,sourceMatch:true}]).match,'a');
  assert.equal(resolveIdentity(row,[{...person,sourceMatch:true},{...person,id:'b'}]).match,null);
  assert.equal(resolveIdentity({...row,phone:null,email:null},[{...person,phone:null}]).match,null);
});
test('CSV export preserves Thai, quotes cells and neutralizes spreadsheet formulas',()=>{
  const result=csv(['name','phone'],[['สมชาย','+66810000001'],[' =HYPERLINK("bad")','a,b'],['\t@SUM(1)','-4']]);
  assert.ok(result.startsWith('\uFEFF'));assert.ok(result.includes('สมชาย'));assert.ok(result.includes('"\'+66810000001"'));assert.ok(result.includes('"\' =HYPERLINK(""bad"")"'));assert.ok(result.includes('"a,b"'));assert.ok(result.includes('"\'\t@SUM(1)"'));
});
test('administrator passwords are salted; session secrets are scoped and expiring',async()=>{
  const password='a-long-test-password';const hashed=await hashPassword(password);assert.notEqual(hashed,await hashPassword(password));assert.equal(await verifyPassword(password,hashed),true);assert.equal(await verifyPassword('wrong',hashed),false);await assert.rejects(hashPassword('short'));
  const token='a'.repeat(64);assert.equal(readToken('other=value; go365_session='+token),token);assert.match(sessionCookie(token),/HttpOnly; SameSite=Strict; Max-Age=28800/);
});
