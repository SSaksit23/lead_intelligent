'use client';
import { useEffect, useMemo, useState } from 'react';
import type { GraphEdge, GraphNode } from '../lib/graph';

type Graph = { rootId:string; nodes:GraphNode[]; edges:GraphEdge[]; limits:{trips:number;coTravelers:number;sources:number} };
const colors:Record<GraphNode['kind'],string>={person:'#28634d',trip:'#b27c2f',agency:'#526b9d',source:'#727e70',segment:'#8a6296'};
const labels:Record<string,[string,string]>={participated_in:['ร่วมทริป','Participated in trip'],agency_recorded:['ระบุเอเย่นต์','Agency recorded'],recorded_in:['ปรากฏในไฟล์','Recorded in file'],member_of:['อยู่ในเซกเมนต์','Segment member']};

export default function CustomerGraph({personId,lang,onOpenPerson}:{personId:string;lang:string;onOpenPerson:(id:string)=>void}){
  const [graph,setGraph]=useState<Graph|null>(null);const [error,setError]=useState('');const [selected,setSelected]=useState('');const [showPeople,setShowPeople]=useState(true);
  useEffect(()=>{let active=true;setGraph(null);setSelected('');setError('');if(!personId)return;
    fetch(`/api/people/${personId}/graph`,{cache:'no-store'}).then(async response=>{const data=await response.json();if(!response.ok)throw new Error(data.error||'Graph unavailable');return data as Graph;}).then(data=>{if(active){setGraph(data);setSelected(`person:${data.rootId}`);}}).catch(e=>{if(active)setError((e as Error).message);});return()=>{active=false;};
  },[personId]);
  const t=(th:string,en:string)=>lang==='th'?th:en;
  const nodes=useMemo(()=>graph?.nodes.filter(n=>showPeople||n.kind!=='person'||n.personId===graph.rootId)||[],[graph,showPeople]);
  const visible=new Set(nodes.map(n=>n.id));
  const edges=graph?.edges.filter(e=>visible.has(e.from)&&visible.has(e.to))||[];
  const positions=new Map<string,{x:number;y:number}>();
  const root=`person:${graph?.rootId}`;positions.set(root,{x:450,y:250});
  const others=nodes.filter(n=>n.id!==root);
  others.forEach((node,index)=>{const angle=-Math.PI/2+2*Math.PI*index/Math.max(others.length,1);const radius=others.length>14?205:170;positions.set(node.id,{x:450+radius*Math.cos(angle),y:250+radius*Math.sin(angle)});});
  const chosen=nodes.find(n=>n.id===selected);
  const linked=edges.filter(e=>e.from===selected||e.to===selected);
  if(!personId)return <div className="empty">{t('เลือกลูกค้าเพื่อดูเครือข่าย','Select a customer to explore connections.')}</div>;
  if(error)return <div className="error" role="alert">{error}</div>;
  if(!graph)return <p className="loading" role="status">{t('กำลังโหลดเครือข่าย…','Loading connections…')}</p>;
  return <div className="graph-layout"><div><div className="graph-toolbar"><span>{nodes.length} {t('จุด','nodes')} · {edges.length} {t('ความเชื่อมโยง','links')}</span><label><input type="checkbox" checked={showPeople} onChange={e=>setShowPeople(e.target.checked)}/>{t('แสดงผู้ร่วมทริป','Show people on the same trip')}</label></div>
    <div className="graph-canvas"><svg viewBox="0 0 900 500" role="img" aria-label={t('แผนภาพความเชื่อมโยงของลูกค้า','Customer connection graph')}>
      {edges.map(edge=>{const a=positions.get(edge.from),b=positions.get(edge.to);return a&&b?<line key={edge.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={edge.from===selected||edge.to===selected?'#b27c2f':'#ccd7cb'} strokeWidth={edge.from===selected||edge.to===selected?2.5:1.5}/>:null;})}
      {nodes.map(node=>{const p=positions.get(node.id)!;const active=selected===node.id;return <g key={node.id} role="button" tabIndex={0} aria-label={`${node.kind}: ${node.label}`} onClick={()=>setSelected(node.id)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setSelected(node.id);}}} style={{cursor:'pointer'}}><circle cx={p.x} cy={p.y} r={node.id===root?37:active?28:24} fill={colors[node.kind]} stroke={active?'#e5b85d':'#fff'} strokeWidth={active?5:3}/><text x={p.x} y={p.y+4} textAnchor="middle" fill="white" fontSize="12">{node.kind==='person'?'●':node.kind==='trip'?'✦':node.kind==='agency'?'A':node.kind==='source'?'↥':'◌'}</text><text x={p.x} y={p.y+(node.id===root?55:42)} textAnchor="middle" fill="#172c2b" fontSize="12" fontWeight={active?700:500}>{node.label.length>19?node.label.slice(0,18)+'…':node.label}</text></g>;})}
    </svg></div><div className="graph-legend">{(['person','trip','agency','source','segment'] as const).map(kind=><span key={kind}><i style={{background:colors[kind]}}/>{t(({person:'บุคคล',trip:'ทริป',agency:'เอเย่นต์',source:'ไฟล์ต้นทาง',segment:'เซกเมนต์'})[kind],kind)}</span>)}</div></div>
    <aside className="graph-detail"><h3>{chosen?.label||t('เลือกจุด','Select a node')}</h3>{chosen&&<><p className="muted">{t(({person:'บุคคล',trip:'ทริป',agency:'เอเย่นต์',source:'ไฟล์ต้นทาง',segment:'เซกเมนต์'})[chosen.kind],chosen.kind)}{chosen.detail?` · ${chosen.detail}`:''}</p>{chosen.kind==='person'&&chosen.personId!==graph.rootId&&<button onClick={()=>onOpenPerson(chosen.personId!)}>{t('เปิดโปรไฟล์','Open profile')} →</button>}{linked.length?<div className="graph-evidence">{linked.map(edge=>{const other=nodes.find(n=>n.id===(edge.from===selected?edge.to:edge.from));return <div key={edge.id}><strong>{labels[edge.kind]?.[lang==='th'?0:1]||edge.kind}</strong><span>{other?.label}</span><small>{edge.evidence}</small></div>;})}</div>:<p className="muted">{t('ไม่มีความเชื่อมโยงที่บันทึกไว้','No recorded links.')}</p>}</>}</aside>
  </div>;
}
