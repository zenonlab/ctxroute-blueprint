import { createHash } from 'node:crypto';
import { safeRequest } from '@favlib/safe-http';

export type NotificationItem = { id:string; userId:string; kind:string; releaseKey:string; payload:any; createdAt:string };
export function dedupe(items:NotificationItem[]){const seen=new Set<string>();return items.filter(item=>{const key=`${item.userId}:${item.kind}:${item.releaseKey}`;if(seen.has(key))return false;seen.add(key);return true})}
export function digest(items:NotificationItem[]){return dedupe(items).map(item=>({id:item.id,kind:item.kind,releaseKey:item.releaseKey,payload:item.payload,createdAt:item.createdAt}))}
export function ntfyUrl(topic:string,base='https://ntfy.sh'){if(!/^[A-Za-z0-9_-]{1,64}$/.test(topic))throw new Error('INVALID_NTFY_TOPIC');const url=new URL(base);if(url.protocol!=='https:'||url.hostname!=='ntfy.sh'||url.port||url.pathname!=='/')throw new Error('NTFY_HOST_NOT_ALLOWED');return url.toString()}

function utf8Limit(value:string,maxBytes:number){let result='';let size=0;for(const character of value){const bytes=Buffer.byteLength(character);if(size+bytes>maxBytes)break;result+=character;size+=bytes}return result}
function label(item:NotificationItem){const payload=item.payload??{};const title=payload.title??payload.media?.title??payload.release?.title??'Nouvelle sortie';const release=payload.release?.sequence?.raw??payload.releaseKey;return utf8Limit(`• ${title} — ${release}`,160)}
export function ntfyMessage(items:NotificationItem[]){const unique=dedupe(items),shown=unique.slice(0,20);let message=shown.map(label).join('\n');if(unique.length>20)message+=`\n+${unique.length-20} autres`;return utf8Limit(message,3500)}
export function sequenceId(items:NotificationItem[]){return createHash('sha256').update(items.map(item=>item.id).join('\n')).digest('hex')}

export class NtfyError extends Error { status:number;retryAt?:number;constructor(status:number,retryAt?:number){super(`NTFY_${status}`);this.status=status;this.retryAt=retryAt} }
function retryTime(response:Response){const value=response.headers.get('retry-after');const seconds=Number(value);if(Number.isFinite(seconds)&&seconds>=0)return Date.now()+seconds*1000;const date=value?Date.parse(value):NaN;return Number.isFinite(date)?date:undefined}
export async function deliverNtfy(topic:string,items:NotificationItem[],fetcher?:typeof fetch,fixedSequenceId=sequenceId(items)){
  const body=JSON.stringify({topic,title:'FavLib — nouvelles sorties',message:ntfyMessage(items),tags:['books'],sequence_id:fixedSequenceId});let status:number;let responseForRetry:Response|undefined;
  if(fetcher){const response=await fetcher(ntfyUrl(topic),{method:'POST',headers:{'content-type':'application/json'},body,signal:AbortSignal.timeout(8000)});status=response.status;responseForRetry=response}
  else {const response=await safeRequest(ntfyUrl(topic),{method:'POST',headers:{'content-type':'application/json','accept':'application/json'},body,timeoutMs:8000,maxBytes:256*1024,mimeTypes:['application/json','application/problem+json'],allowedHosts:['ntfy.sh'],maxRedirects:0,requireHttps:true});status=response.status;responseForRetry=new Response(response.body,{status,headers:response.headers as HeadersInit})}
  if(status<200||status>=300)throw new NtfyError(status,status===429&&responseForRetry?retryTime(responseForRetry):undefined);return true;
}
