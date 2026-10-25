import type { Mapping, NormalizedRow, RowIssue } from './contracts';
export const synonyms: Record<string,string[]> = {
  name:['full name','fullname','customer','customer name','ชื่อ-นามสกุล','ชื่อ นามสกุล'],firstName:['name','firstname','first name','given name','ชื่อ','ชื่อจริง','ชื่อภาษาไทย'],lastName:['surname','lastname','last name','family name','นามสกุล','สกุล'],
  phone:['phone','tel','tel.','telephone','mobile','โทร','เบอร์','เบอร์โทร','โทรศัพท์'],email:['email','e-mail','อีเมล'],sourceId:['customer id','customer_id','source id','sourceid','รหัสลูกค้า'],agency:['agency code','agent code','agency reference','รหัสเอเย่นต์'],agencyName:['agency','agency name','agent','sub agent','subagent','เอเย่นต์','ตัวแทน','ชื่อเอเย่นต์'],birthDate:['d.o.b.','dob','date of birth','birth date','birthdate','วันเกิด','วันเดือนปีเกิด'],gender:['sex','gender','เพศ'],remark:['remark','remarks','remark อื่นๆ','หมายเหตุ','หมายเหตุอื่นๆ'],tripCode:['program code','program_code','trip code','รหัสทัวร์'],tripName:['program name','program_name','trip name','ชื่อทัวร์'],departureDate:['departure date','travel date','departure_date','วันเดินทาง']
};
export const token = (s:string) => s.normalize('NFKC').toLowerCase().replace(/[._:/\\\-]+/g,' ').replace(/\s+/g,' ').trim();
const missing=(value:string)=>!value.trim()||['-','—','–','n/a','na','null'].includes(value.trim().toLowerCase());
export function suggestMapping(rows:string[][]) {
  let headerRow=0,best=0; let columns:Record<string, keyof NormalizedRow|'firstName'|'lastName'>={};
  const ambiguous:string[]=[];
  rows.slice(0,40).forEach((row,i)=>{ const map:typeof columns={}; let hits=0;
    row.forEach((cell,j)=>{const matches=Object.entries(synonyms).filter(([,vs])=>vs.some(v=>token(v)===token(cell))); if(matches.length===1){map[String(j)]=matches[0][0] as keyof typeof synonyms as keyof NormalizedRow;hits++;}});
    if(hits>best){best=hits;headerRow=i;columns=map;}
  });
  const used=new Set<string>();
  for(const [col,field] of Object.entries(columns)){if(used.has(field)){ambiguous.push(field);delete columns[col];}else used.add(field);}
  return {mapping:{version:2 as const,sheet:0,headerRow,columns},ambiguous,recognized:best};
}
export function normalizePhone(value:string):string|null {
  const s=value.trim(); if(missing(s))return null;
  if(!/^[+\d\s().-]+$/.test(s))return null;
  let digits=s.replace(/\D/g,'');
  if(digits.startsWith('0066'))digits=digits.slice(2);
  if(digits.startsWith('0') && digits.length>=9 && digits.length<=10)digits='66'+digits.slice(1);
  if(digits.length<8||digits.length>15)return null;
  return '+'+digits;
}
export function normalizeDate(s:string):string|null {
  if(missing(s))return null;
  let y:number,m:number,d:number;let match=s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T].*)?$/);
  if(match){[,y,m,d]=match.map(Number);}else{match=s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);if(!match)return null;[,d,m,y]=match.map(Number);}
  if(y>2400)y-=543;
  const date=new Date(Date.UTC(y,m-1,d));
  if(y<1900||y>2200||date.getUTCFullYear()!==y||date.getUTCMonth()!==m-1||date.getUTCDate()!==d)return null;
  return date.toISOString().slice(0,10);
}
export function normalizeGender(value:string):'male'|'female'|'other'|null {
  if(missing(value))return null;
  const s=token(value);
  if(!s||['n a','unknown','ไม่ทราบ'].includes(s))return null;
  if(['m','male','man','ชาย','ผู้ชาย'].includes(s))return 'male';
  if(['f','female','woman','หญิง','ผู้หญิง'].includes(s))return 'female';
  if(['other','อื่น','อื่นๆ','nonbinary','non binary'].includes(s))return 'other';
  return null;
}
export function normalizeAgencyName(value:string|null):string|null {
  if(!value)return null;
  if(!value.includes('//'))return value;
  const after=value.split('//',2)[1].trim();
  const match=after.match(/^([A-Z][A-Z0-9&.'() -]{1,100}?)(?=\s+[\u0E00-\u0E7F]|\s+\d+\s*PAX\b|$)/u);
  return match?.[1].trim()||null;
}
export function normalizeRow(cells:string[],mapping:Mapping):{data:NormalizedRow;errors:RowIssue[]} {
  const raw:Record<string,string>={}; const errors:RowIssue[]=[];
  for(const [i,f] of Object.entries(mapping.columns)) raw[f]=(cells[Number(i)]||'').trim();
  const name=(raw.name || [raw.firstName,raw.lastName].filter(Boolean).join(' ')).replace(/\s+/g,' ');
  const clean=(value:string|undefined)=>value&&!missing(value)?value:null;
  const phone=normalizePhone(raw.phone||'');const email=clean(raw.email)?.toLowerCase()||null;const departureDate=normalizeDate(raw.departureDate||'');const birthDate=normalizeDate(raw.birthDate||'');const gender=normalizeGender(raw.gender||'');
  if(!name)errors.push({field:'name',message:'A name is required / ต้องระบุชื่อ'});
  if(name.length>300)errors.push({field:'name',message:'Name exceeds 300 characters'});
  if(clean(raw.phone)&&!phone)errors.push({field:'phone',message:'Invalid phone number / เบอร์โทรไม่ถูกต้อง'});
  if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))errors.push({field:'email',message:'Invalid email / อีเมลไม่ถูกต้อง'});
  if(clean(raw.departureDate)&&!departureDate)errors.push({field:'departureDate',message:'Use YYYY-MM-DD or DD/MM/YYYY / ระบุวันที่ให้ชัดเจน'});
  if(clean(raw.birthDate)&&!birthDate)errors.push({field:'birthDate',message:'Invalid birth date / วันเกิดไม่ถูกต้อง'});
  if(clean(raw.gender)&&!gender&&!['unknown','ไม่ทราบ'].includes(token(raw.gender)))errors.push({field:'gender',message:'Use M/F, male/female, ชาย/หญิง or other / ระบุเพศให้ชัดเจน'});
  const agencyRaw=clean(raw.agencyName)||clean(raw.agency);
  const agencyName=normalizeAgencyName(agencyRaw);
  return {data:{name,phone,email,sourceId:clean(raw.sourceId),agency:clean(raw.agency)||agencyRaw,agencyName,birthDate,gender,remark:clean(raw.remark),tripCode:clean(raw.tripCode),tripName:clean(raw.tripName),departureDate},errors};
}
export function validateMapping(mapping:Mapping,width:number,headers:string[]=[] ) {
  const values=Object.values(mapping.columns);
  if(new Set(values).size!==values.length)throw new Error('Map each field once; resolve ambiguous columns.');
  if(!values.includes('name')&&!values.includes('firstName'))throw new Error('Map a name column before preview.');
  if(Object.keys(mapping.columns).some(i=>Number(i)>=width))throw new Error('Mapped column does not exist.');
  const restricted=new Set(['id','national id','national id number','passport','passport no','passport number','เลขบัตรประชาชน','เลขหนังสือเดินทาง','หนังสือเดินทาง']);
  if(Object.keys(mapping.columns).some(i=>restricted.has(token(headers[Number(i)]||''))))throw new Error('National ID and passport columns cannot be mapped / ไม่สามารถนำเข้าเลขบัตรหรือพาสปอร์ต');
}
