import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const base=(process.argv[2]??'https://favlib.home.arpa').replace(/\/$/,'');
const staging=mkdtempSync(join(tmpdir(),'favlib-published-extension-'));
try{
  const releaseResponse=execFileSync('curl',[...((base.includes('.home.arpa'))?['--insecure']:[]),'--fail','--silent','--show-error','--location',`${base}/downloads/favlib-extension-releases.json`]);const releaseManifest=JSON.parse(releaseResponse.toString());
  for(const browser of ['chrome','firefox']){
    const downloadUrl=new URL(`${base}/downloads/favlib-extension-${browser}.zip`);const curlArgs=['--fail','--silent','--show-error','--location'];
    if(downloadUrl.hostname==='home.arpa'||downloadUrl.hostname.endsWith('.home.arpa'))curlArgs.push('--insecure');
    curlArgs.push(downloadUrl.toString());
    const archive=join(staging,`${browser}.zip`);writeFileSync(archive,execFileSync('curl',curlArgs));
    const entries=execFileSync('unzip',['-Z1',archive],{encoding:'utf8'}).split('\n').filter(Boolean);
    if(!entries.includes('manifest.json'))throw new Error(`${browser}: manifest.json is not at archive root`);
    if(entries.some(entry=>entry==='.output'||entry.startsWith('.output/')))throw new Error(`${browser}: archive contains .output`);
    const manifest=JSON.parse(execFileSync('unzip',['-p',archive,'manifest.json'],{encoding:'utf8'})),release=releaseManifest.releases.find(item=>item.browser===browser);if(!release||manifest.version!==release.version||release.version!==releaseManifest.version)throw new Error(`${browser}: published versions diverge`);if(release.artifactUrl.endsWith('.zip')&&createHash('sha256').update(readFileSync(archive)).digest('hex')!==release.checksumSha256)throw new Error(`${browser}: checksum diverges`);
    console.log(`${browser}: published ZIP valid (${entries.length} entries)`);
  }
}finally{rmSync(staging,{recursive:true,force:true})}
