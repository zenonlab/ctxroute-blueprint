import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Agent, request } from 'undici';

export type SafeHttpOptions = {
  method?: 'GET'|'POST'|'PUT'|'PATCH'|'DELETE'; headers?: Record<string,string>; body?: string|Uint8Array;
  timeoutMs?: number; maxBytes: number; mimeTypes: readonly string[]; maxRedirects?: number;
  allowedHosts?: readonly string[]; resolver?: (hostname:string,options:{all:true;verbatim:true})=>Promise<{address:string;family:4|6}[]>; allowPrivateTest?: boolean; requireHttps?:boolean;
};
export type SafeHttpResponse = { status:number; headers:Record<string,string|string[]>; body:Buffer; url:string };

function ipv4Number(address:string){return address.split('.').reduce((value,part)=>(value<<8)+Number(part),0)>>>0}
function inV4(value:number,base:string,bits:number){const mask=bits===0?0:(0xffffffff<<(32-bits))>>>0;return (value&mask)===(ipv4Number(base)&mask)}
export function isPublicAddress(address:string):boolean {
  const family=isIP(address);
  if(family===4){const value=ipv4Number(address);return ![
    ['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],
    ['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],
    ['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],
  ].some(([base,bits])=>inV4(value,String(base),Number(bits)))}
  if(family===6){const normalized=address.toLowerCase().split('%')[0];if(normalized.startsWith('::ffff:'))return isPublicAddress(normalized.slice(7));return normalized!=='::'&&normalized!=='::1'&&!normalized.startsWith('fc')&&!normalized.startsWith('fd')&&!/^fe[89ab]/.test(normalized)&&!normalized.startsWith('ff')&&!normalized.startsWith('2001:db8')}
  return false;
}
function hostAllowed(host:string,allowedHosts:readonly string[]|undefined){if(!allowedHosts?.length)return true;return allowedHosts.some(value=>{const allowed=value.toLowerCase().replace(/^\./,'');return host===allowed||host.endsWith(`.${allowed}`)})}
async function resolvePublic(host:string,options:SafeHttpOptions){
  let literal:{address:string;family:4|6}[];if(isIP(host))literal=[{address:host,family:isIP(host) as 4|6}];else if(options.resolver)literal=await options.resolver(host,{all:true,verbatim:true});else literal=(await dnsLookup(host,{all:true,verbatim:true})).map(item=>({address:item.address,family:item.family as 4|6}));
  if(!literal.length)throw new Error('DNS_UNAVAILABLE');if(!options.allowPrivateTest&&literal.some(item=>!isPublicAddress(item.address)))throw new Error('NON_PUBLIC_ADDRESS');return literal;
}
function responseMime(headers:Record<string,string|string[]>,allowed:readonly string[]){const raw=Array.isArray(headers['content-type'])?headers['content-type'][0]:headers['content-type'];if(!raw)throw new Error('MIME_REQUIRED');const mime=raw.split(';',1)[0].trim().toLowerCase();if(!allowed.map(item=>item.toLowerCase()).includes(mime))throw new Error('MIME_NOT_ALLOWED')}
export async function safeRequest(input:string|URL,options:SafeHttpOptions):Promise<SafeHttpResponse>{
  let current=new URL(input);const redirects=options.maxRedirects??2;
  for(let redirect=0;redirect<=redirects;redirect++){
    if(!['http:','https:'].includes(current.protocol))throw new Error('HTTP_PROTOCOL_REQUIRED');if(options.requireHttps&&current.protocol!=='https:')throw new Error('HTTPS_REQUIRED');const host=current.hostname.toLowerCase();if(!hostAllowed(host,options.allowedHosts))throw new Error('HOST_NOT_ALLOWED');
    const addresses=await resolvePublic(host,options);let index=0;const dispatcher=new Agent({connect:{lookup:(_hostname,lookupOptions,callback)=>{const selected=addresses[index++%addresses.length];if(lookupOptions.all)(callback as (error:null,addresses:{address:string;family:4|6}[])=>void)(null,[selected]);else (callback as (error:null,address:string,family:4|6)=>void)(null,selected.address,selected.family)}}});
    try{
      const response=await request(current,{dispatcher,method:options.method??'GET',headers:options.headers,body:options.body,headersTimeout:options.timeoutMs??8000,bodyTimeout:options.timeoutMs??8000,signal:AbortSignal.timeout(options.timeoutMs??8000)});const headers=response.headers as Record<string,string|string[]>;
      if(response.statusCode>=300&&response.statusCode<400){await response.body.dump();if(redirect===redirects)throw new Error('REDIRECT_LIMIT');const location=Array.isArray(headers.location)?headers.location[0]:headers.location;if(!location)throw new Error('REDIRECT_WITHOUT_LOCATION');current=new URL(location,current);continue}
      const declared=Number(Array.isArray(headers['content-length'])?headers['content-length'][0]:headers['content-length']);if(Number.isFinite(declared)&&declared>options.maxBytes){await response.body.dump();throw new Error('RESPONSE_TOO_LARGE')}if(response.statusCode>=200&&response.statusCode<300)responseMime(headers,options.mimeTypes);
      const chunks:Buffer[]=[];let size=0;for await(const chunk of response.body){const value=Buffer.from(chunk);size+=value.length;if(size>options.maxBytes){response.body.destroy();throw new Error('RESPONSE_TOO_LARGE')}chunks.push(value)}return {status:response.statusCode,headers,body:Buffer.concat(chunks),url:current.toString()};
    }finally{await dispatcher.close()}
  }throw new Error('REDIRECT_LIMIT');
}
export async function safeJson<T=unknown>(input:string|URL,options:Omit<SafeHttpOptions,'mimeTypes'>):Promise<{data:T;response:SafeHttpResponse}>{const response=await safeRequest(input,{...options,mimeTypes:['application/json','application/problem+json']});try{return {data:JSON.parse(response.body.toString('utf8')) as T,response}}catch{throw new Error('INVALID_JSON')}}
export async function safeText(input:string|URL,options:Omit<SafeHttpOptions,'mimeTypes'> & {mimeTypes?:readonly string[]}):Promise<{text:string;response:SafeHttpResponse}>{const response=await safeRequest(input,{...options,mimeTypes:options.mimeTypes??['text/html','application/xhtml+xml']});return {text:response.body.toString('utf8'),response}}
