import { getSql } from '../db';
import { memberIds } from './people';
import type { Actor } from './contracts';

export type GraphNode = { id:string; kind:'person'|'trip'|'agency'|'source'|'segment'; label:string; detail?:string; personId?:string };
export type GraphEdge = { id:string; from:string; to:string; kind:string; evidence:string };

// This is a bounded, evidence-backed projection of existing GO365 records.
// It does not infer family, friendship, identity, or a commercial booking.
export async function customerGraph(actor:Actor, personId:string) {
  return getSql().begin(async tx=>{
    const {root,ids}=await memberIds(tx,actor,personId);
    const [person]=await tx`select id,name from people where tenant_id=${actor.tenantId} and id=${root}`;
    const nodes:GraphNode[]=[{id:`person:${root}`,kind:'person',label:person.name,personId:root}];
    const edges:GraphEdge[]=[];
    const addNode=(node:GraphNode)=>{if(!nodes.some(n=>n.id===node.id))nodes.push(node);};
    const addEdge=(edge:GraphEdge)=>{if(!edges.some(e=>e.id===edge.id))edges.push(edge);};
    const trips=await tx`select distinct t.id,t.name,t.departure_date,r.row_number,b.filename
      from participation p join trips t on t.id=p.trip_id and t.tenant_id=p.tenant_id
      join import_rows r on r.id=p.row_id join import_batches b on b.id=r.batch_id
      where p.tenant_id=${actor.tenantId} and p.person_id in ${tx(ids)}
      order by t.departure_date desc nulls last,t.id,r.row_number limit 18`;
    for(const trip of trips){
      const id=`trip:${trip.id}`;
      addNode({id,kind:'trip',label:trip.name,detail:trip.departure_date||undefined});
      addEdge({id:`${root}:${trip.id}`,from:`person:${root}`,to:id,kind:'participated_in',evidence:`${trip.filename} · row ${trip.row_number}`});
    }
    const tripIds=trips.map(t=>t.id as string);
    if(tripIds.length){
      const companions=await tx`select distinct on (t.id,canonical.id) t.id as trip_id,canonical.id,canonical.name,r.row_number,b.filename
        from participation p join trips t on t.id=p.trip_id and t.tenant_id=p.tenant_id
        join people child on child.id=p.person_id and child.tenant_id=p.tenant_id
        join people canonical on canonical.id=coalesce(child.merged_into,child.id) and canonical.tenant_id=p.tenant_id
        join import_rows r on r.id=p.row_id join import_batches b on b.id=r.batch_id
        where p.tenant_id=${actor.tenantId} and t.id in ${tx(tripIds)} and canonical.id<>${root}
        order by t.id,canonical.id,r.row_number limit 32`;
      for(const other of companions){
        const id=`person:${other.id}`;
        addNode({id,kind:'person',label:other.name,personId:other.id});
        addEdge({id:`${other.id}:${other.trip_id}`,from:id,to:`trip:${other.trip_id}`,kind:'participated_in',evidence:`${other.filename} · row ${other.row_number}`});
      }
    }
    const agencies=await tx`select distinct nullif(trim(agency_name),'') as name from people where tenant_id=${actor.tenantId} and id in ${tx(ids)} and nullif(trim(agency_name),'') is not null limit 8`;
    for(const agency of agencies){const name=String(agency.name);const id=`agency:${name}`;addNode({id,kind:'agency',label:name});addEdge({id:`${root}:agency:${name}`,from:`person:${root}`,to:id,kind:'agency_recorded',evidence:'Imported agency name'});}
    const sources=await tx`select distinct b.id,b.filename,s.source,r.row_number from source_links s
      join import_rows r on r.id=s.row_id join import_batches b on b.id=r.batch_id
      where s.tenant_id=${actor.tenantId} and s.person_id in ${tx(ids)}
      order by b.id,r.row_number limit 16`;
    for(const source of sources){const id=`source:${source.id}`;addNode({id,kind:'source',label:source.filename,detail:source.source});addEdge({id:`${root}:source:${source.id}:${source.row_number}`,from:`person:${root}`,to:id,kind:'recorded_in',evidence:`${source.source} · row ${source.row_number}`});}
    const segments=await tx`select distinct s.id,s.name from segment_memberships m join segments s on s.id=m.segment_id and s.tenant_id=m.tenant_id
      where m.tenant_id=${actor.tenantId} and m.person_id in ${tx(ids)} and m.valid_to is null limit 12`;
    for(const segment of segments){const id=`segment:${segment.id}`;addNode({id,kind:'segment',label:segment.name});addEdge({id:`${root}:segment:${segment.id}`,from:`person:${root}`,to:id,kind:'member_of',evidence:'Active segment membership'});}
    return {rootId:root,nodes,edges,limits:{trips:18,coTravelers:32,sources:16},scope:'Recorded GO365 relationships only'};
  });
}
