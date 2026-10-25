export function csv(headers:string[],rows:unknown[][]):string {
  function cell(v:unknown){let s=v==null?'':String(v);if(/^[\s\u0000-\u001f]*[=+@-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}
  return '\uFEFF'+[headers,...rows].map(row=>row.map(cell).join(',')).join('\r\n');
}
