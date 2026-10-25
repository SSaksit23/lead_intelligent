import { acceptLineWebhook } from '../../../../lib/line';
import { AppError } from '../../../../lib/contracts';
export const runtime='nodejs';
export async function POST(request:Request){
  try{const raw=Buffer.from(await request.arrayBuffer());return Response.json(await acceptLineWebhook(raw,request.headers.get('x-line-signature')),{headers:{'Cache-Control':'no-store'}});}
  catch(error){if(error instanceof AppError)return Response.json({error:error.message},{status:error.status});console.error('LINE webhook failed:',error instanceof Error?error.name:'unknown');return Response.json({error:'Service unavailable.'},{status:503});}
}
