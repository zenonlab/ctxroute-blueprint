import { cpSync, existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = resolve(new URL('../../..', import.meta.url).pathname);
const outputRoot = resolve(root, 'apps/extension/.output');
const downloadRoot = resolve(root, 'apps/web/public/downloads');
const stagingRoot = mkdtempSync(join(downloadRoot, '.favlib-extension-package-'));
const packageVersion=JSON.parse(readFileSync(resolve(root,'apps/extension/package.json'),'utf8')).version;
const protocol=1;
const checksum=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const staged=[];
const cli=new Map();for(let index=2;index<process.argv.length;index+=2){const key=process.argv[index],value=process.argv[index+1];if(!key?.startsWith('--')||!value)throw new Error('Signing options require --name value pairs');cli.set(key,value)}

try {
  for (const [browser, outputName] of [['chrome', 'chrome-mv3'], ['firefox', 'firefox-mv3']]) {
    const source = join(outputRoot, outputName);
    const staging = join(stagingRoot, browser);
    const archive = join(stagingRoot, `favlib-extension-${browser}.zip`);
    const destinationName=`favlib-extension-${browser}.zip`;
    cpSync(source, staging, { recursive: true });
    execFileSync('zip', ['-qr', archive, '.'], { cwd: staging, stdio: 'inherit' });
    const entries = execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8' }).split('\n').filter(Boolean);
    if (entries.some(entry => entry === '.output' || entry.startsWith('.output/'))) throw new Error(`${browser} package contains .output`);
    if (!entries.includes('manifest.json')) throw new Error(`${browser} package must contain manifest.json at its root`);
    const manifest=JSON.parse(execFileSync('unzip',['-p',archive,'manifest.json'],{encoding:'utf8'}));
    if(manifest.version!==packageVersion)throw new Error(`${browser}: package ${packageVersion} and manifest ${manifest.version} diverge`);
    staged.push({source:archive,name:destinationName,browser,mode:'manual-zip',updateManifestUrl:null});
  }

  const chromeCrx=cli.get('--chrome-crx'),chromeId=cli.get('--chrome-id');
  if(Boolean(chromeCrx)!==Boolean(chromeId))throw new Error('Chrome CRX and extension id must be provided together');
  if(chromeCrx){if(!existsSync(chromeCrx))throw new Error('Signed Chrome CRX is missing');const name='favlib-extension-chrome.crx';const target=join(stagingRoot,name);cpSync(chromeCrx,target);staged.push({source:target,name,browser:'chrome',mode:'managed-crx3',updateManifestUrl:'https://favlib.home.arpa/downloads/favlib-extension-chrome-updates.xml'});writeFileSync(join(stagingRoot,'favlib-extension-chrome-updates.xml'),`<?xml version="1.0" encoding="UTF-8"?>\n<gupdate xmlns="http://www.google.com/update2/response" protocol="2.0"><app appid="${chromeId}"><updatecheck codebase="https://favlib.home.arpa/downloads/${name}" version="${packageVersion}" /></app></gupdate>\n`);staged.push({source:join(stagingRoot,'favlib-extension-chrome-updates.xml'),name:'favlib-extension-chrome-updates.xml'});}

  const firefoxXpi=cli.get('--firefox-xpi');
  if(firefoxXpi){if(!existsSync(firefoxXpi))throw new Error('AMO-signed Firefox XPI is missing');const signedManifest=JSON.parse(execFileSync('unzip',['-p',firefoxXpi,'manifest.json'],{encoding:'utf8'}));if(signedManifest.version!==packageVersion)throw new Error(`Firefox signed version ${signedManifest.version} diverges from ${packageVersion}`);if(signedManifest.browser_specific_settings?.gecko?.id!=='favlib@favlib.home.arpa')throw new Error('Firefox signed XPI has an unstable id');const name='favlib-extension-firefox.xpi',target=join(stagingRoot,name);cpSync(firefoxXpi,target);staged.push({source:target,name,browser:'firefox',mode:'amo-unlisted-xpi',updateManifestUrl:'https://favlib.home.arpa/downloads/favlib-extension-firefox-updates.json'});writeFileSync(join(stagingRoot,'favlib-extension-firefox-updates.json'),JSON.stringify({addons:{'favlib@favlib.home.arpa':{updates:[{version:packageVersion,update_link:`https://favlib.home.arpa/downloads/${name}`,update_hash:`sha256:${checksum(target)}`}]}}},null,2));staged.push({source:join(stagingRoot,'favlib-extension-firefox-updates.json'),name:'favlib-extension-firefox-updates.json'});}

  const preferred=browser=>[...staged].reverse().find(item=>item.browser===browser);
  const releases=['chrome','firefox'].map(browser=>{const item=preferred(browser);return {browser,version:packageVersion,protocol,checksumSha256:checksum(item.source),artifactUrl:`https://favlib.home.arpa/downloads/${item.name}`,updateManifestUrl:item.updateManifestUrl,installationMode:item.mode,publishedAt:new Date().toISOString()}});
  const releaseFile=join(stagingRoot,'favlib-extension-releases.json');writeFileSync(releaseFile,JSON.stringify({version:packageVersion,protocol,releases},null,2));staged.push({source:releaseFile,name:'favlib-extension-releases.json'});
  // Nothing becomes visible before every archive, version and checksum validates.
  for(const item of staged)renameSync(item.source,join(downloadRoot,item.name));
} finally {
  rmSync(stagingRoot, { recursive: true, force: true });
}
