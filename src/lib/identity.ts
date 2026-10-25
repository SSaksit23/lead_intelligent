import type { NormalizedRow } from './contracts';
export type Candidate={id:string; name:string; phone:string|null; email:string|null; sourceMatch:boolean};
// A phone by itself is insufficient: family/agency phones are routinely shared.
export function resolveIdentity(row:NormalizedRow,candidates:Candidate[]){
  const ids=[...new Set(candidates.map(c=>c.id))];
  if(ids.length>1)return {match:null,candidates:ids,reason:'Conflicting or shared identity keys'};
  if(ids.length===1){const c=candidates[0];
    const nameMatches=c.name.normalize('NFKC').toLowerCase()===row.name.normalize('NFKC').toLowerCase();
    if(c.sourceMatch||(row.email&&c.email===row.email&&nameMatches)||(row.phone&&c.phone===row.phone&&nameMatches&&row.email&&c.email===row.email))return {match:c.id,candidates:[],reason:''};
    return {match:null,candidates:ids,reason:'Shared phone, contact disagreement or name-only similarity'};
  }
  return {match:null,candidates:[],reason:''};
}
