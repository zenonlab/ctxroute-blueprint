type Helpers={query:(sql:string,values?:unknown[])=>Promise<any>};
export async function saveAssertions(helpers:Helpers,mediaId:string,provider:string,sourceUrl:string,confidence:number,attribution:string|null,values:Record<string,unknown>){
  for(const [field,value] of Object.entries(values)){
    if(value===undefined||value===null||(Array.isArray(value)&&value.length===0))continue;
    await helpers.query('INSERT INTO metadata_assertion(media_id,field,value,provider,source_url,confidence,attribution) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(media_id,field,provider,source_url) DO UPDATE SET value=excluded.value,confidence=excluded.confidence,attribution=excluded.attribution,asserted_at=now()',[mediaId,field,JSON.stringify(value),provider,sourceUrl,confidence,attribution]);
  }
}
