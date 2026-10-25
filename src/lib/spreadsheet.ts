import * as XLSX from 'xlsx';
import { AppError, Mapping } from './contracts';
import { suggestMapping, normalizeRow,validateMapping } from './normalize';
export const MAX_BYTES=10*1024*1024;
export const MAX_ROWS=10000;
export function readWorkbook(bytes:Buffer,filename:string){
  if(!/\.(csv|xlsx|xls)$/i.test(filename))throw new AppError(400,'Use CSV, XLS or XLSX.');
  if(bytes.length>MAX_BYTES)throw new AppError(413,'Maximum file size is 10 MB.');
  let book:XLSX.WorkBook;
  // SheetJS otherwise guesses a legacy code page for some BOM-less UTF-8 CSV exports.
  let input=bytes;
  if(/\.csv$/i.test(filename)&&!bytes.subarray(0,3).equals(Buffer.from([0xef,0xbb,0xbf]))){
    try{new TextDecoder('utf-8',{fatal:true}).decode(bytes);input=Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),bytes]);}catch{/* Retain the original bytes for legacy encoded CSV. */}
  }
  try{book=XLSX.read(input,{type:'buffer',cellDates:true,dense:true,sheetRows:MAX_ROWS+42,raw:true});}catch{throw new AppError(400,'Cannot read spreadsheet. Check format or password protection.');}
  if(!book.SheetNames.length||book.SheetNames.length>20)throw new AppError(400,'Workbook must contain 1–20 sheets.');
  const sheets=book.SheetNames.map(name=>{
    const sheet=book.Sheets[name];
    const range=sheet['!fullref']||sheet['!ref'];
    if(range){const r=XLSX.utils.decode_range(range);if(r.e.r>=MAX_ROWS+41||r.e.c>=100)throw new AppError(400,'Maximum 10,000 data rows and 100 columns. Split large files.');}
    const rows=XLSX.utils.sheet_to_json<unknown[]>(sheet,{header:1,defval:'',raw:true,blankrows:true}).map(row=>row.map(value=>value instanceof Date?value.toISOString().slice(0,10):String(value??'').trim()));
    if(rows.some(r=>r.some(c=>c.length>5000)))throw new AppError(400,'A cell exceeds 5,000 characters.');
    return {name,rows};
  });
  return sheets;
}
export function previewWorkbook(bytes:Buffer,filename:string){
  const sheets=readWorkbook(bytes,filename);
  return sheets.map((s,index)=>{const suggestion=suggestMapping(s.rows);return {name:s.name,index,rowCount:s.rows.length,sample:s.rows.slice(0,45),...suggestion,mapping:{...suggestion.mapping,sheet:index}};});
}
export function parseMapped(bytes:Buffer,filename:string,input:unknown){
  const mapping=Mapping.parse(input);const sheets=readWorkbook(bytes,filename);const sheet=sheets[mapping.sheet];
  if(!sheet||!sheet.rows[mapping.headerRow])throw new AppError(400,'Sheet/header row does not exist.');
  try{validateMapping(mapping,Math.max(...sheet.rows.map(r=>r.length)),sheet.rows[mapping.headerRow]);}catch(e){throw new AppError(400,(e as Error).message);}
  const rows=sheet.rows.slice(mapping.headerRow+1).flatMap((cells,i)=>cells.every(c=>!c)?[]:[{rowNumber:mapping.headerRow+i+2,...normalizeRow(cells,mapping)}]);
  if(!rows.length||rows.length>MAX_ROWS)throw new AppError(400,'Select a header above 1–10,000 data rows.');
  return {mapping,rows};
}
