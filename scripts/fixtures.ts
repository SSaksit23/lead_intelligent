import { mkdir,writeFile } from 'node:fs/promises';
import * as XLSX from 'xlsx';
const rows=[['customer id','ชื่อ-นามสกุล','โทรศัพท์','อีเมล','agency','trip code','trip name','departure date'],['C001','สมชาย ใจดี','0810000001','somchai@example.test','Northern Demo','KM001','คุนหมิง — ตัวอย่าง','2026-12-10'],['C002','มาลี สุขใจ','0810000001','','Northern Demo','','',''],['C003','Invalid example','not-a-phone','bad-email','','','','31/02/2026'],['C004','No date example','','','','DEMO','Unknown date trip','']];
await mkdir('samples',{recursive:true});
for(const format of ['csv','biff8','xlsx'] as const){const workbook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet(rows),'GO365 sample');await writeFile(`samples/go365-synthetic.${format==='biff8'?'xls':format}`,XLSX.write(workbook,{bookType:format,type:'buffer'}));}
console.log('Synthetic CSV/XLS/XLSX fixtures written to samples/.');
