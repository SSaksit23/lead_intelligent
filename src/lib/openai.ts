import { readFileSync } from 'node:fs';

function apiKey(){
  if(process.env.OPENAI_API_KEY?.trim())return process.env.OPENAI_API_KEY.trim();
  if(process.env.OPENAI_API_KEY_FILE){try{return readFileSync(process.env.OPENAI_API_KEY_FILE,'utf8').trim();}catch{return '';}}
  return '';
}
export const openAiConfigured=()=>process.env.AI_SEGMENT_ENABLED==='true'&&!!apiKey();
export const openAiModel=()=>process.env.OPENAI_MODEL||'gpt-5-mini';

export async function openAiJson<T>(name:string,schema:Record<string,unknown>,instructions:string,input:unknown):Promise<{model:string;data:T}>{
  const key=apiKey();
  if(!openAiConfigured()||!key)throw new Error('OpenAI API is not configured.');
  const model=openAiModel();
  const response=await fetch('https://api.openai.com/v1/responses',{
    method:'POST',
    headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},
    signal:AbortSignal.timeout(60000),
    body:JSON.stringify({model,store:false,max_output_tokens:2500,instructions,input:JSON.stringify(input),text:{format:{type:'json_schema',name,strict:true,schema}}}),
  });
  if(!response.ok)throw new Error(`OpenAI API returned HTTP ${response.status}.`);
  const result=await response.json() as {status?:string;output_text?:string;output?:{type:string;content?:{type:string;text?:string}[]}[]};
  const content=result.output_text||result.output?.flatMap(item=>item.type==='message'?item.content||[]:[]).find(part=>part.type==='output_text')?.text;
  if(result.status!=='completed'||!content)throw new Error('OpenAI returned no complete structured result.');
  return {model,data:JSON.parse(content) as T};
}
