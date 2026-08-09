export type SiteManifestMetadata={language:string|null;country:string|null;direction:'ltr'|'rtl'|null;manifestUrl:string};

export function manifestMetadata(value:unknown,manifestUrl:string):SiteManifestMetadata{
  const manifest=value&&typeof value==='object'?value as Record<string,unknown>:{};
  const rawLanguage=typeof manifest.lang==='string'?manifest.lang.trim():'';
  const language=rawLanguage||null;
  const region=rawLanguage.match(/[-_]([A-Za-z]{2}|\d{3})$/)?.[1];
  return {language,country:region&&/^[A-Za-z]{2}$/.test(region)?region.toUpperCase():null,direction:manifest.dir==='ltr'||manifest.dir==='rtl'?manifest.dir:null,manifestUrl};
}
