import { describe, expect, it } from 'vitest';
import { compareStatisticalLanguageDetectors, detectLanguage, detectLanguageFromDocument, detectLanguageFromUrl, detectLanguageStatistically, languageMatches, resolvePageLanguage, statisticalLanguageDecision } from './language.js';
describe('source language detection',()=>{it('prioritizes URL',()=>expect(detectLanguageFromUrl('https://synthetic.invalid/en/work').language).toBe('en'));it('supports every ISO-style badge family',()=>expect(detectLanguageFromUrl('https://synthetic.invalid/sv/work').language).toBe('sv'));it('uses manifest fallback',()=>expect(detectLanguage('https://synthetic.invalid/work','fr-FR').language).toBe('fr-FR'));it('uses a declared document language when manifest is silent',()=>expect(detectLanguageFromDocument('https://synthetic.invalid/work','en-US')).toMatchObject({language:'en-US',method:'document'}));it('rejects ambiguity and absence',()=>{expect(detectLanguageFromUrl('https://synthetic.invalid/en/fr/work').method).toBe('ambiguous');expect(detectLanguage('https://synthetic.invalid/work',null).language).toBeNull()});it('matches primary locale',()=>expect(languageMatches('en-US','en')).toBe(true))});
describe('statistical language fallback',()=>{it('rejects short text and accepts a long clear sample',()=>{expect(detectLanguageStatistically('short')).toMatchObject({language:null,confidence:0});const text='This synthetic English page contains enough natural language to identify the document reliably. It describes a chapter, a work, and the latest release without relying on a title alone.';expect(detectLanguageStatistically(text)).toMatchObject({language:'en',detector:'franc-min'});expect(compareStatisticalLanguageDetectors(text).franc).toBe('en');});});
describe('ELD arbitration',()=>{it('uses reliable ELD only when franc is undecided and rejects a reliable disagreement',()=>{expect(statisticalLanguageDecision(null,'fr')).toEqual({language:'fr',method:'document',detector:'eld'});expect(statisticalLanguageDecision('en','fr')).toEqual({language:null,method:'ambiguous',detector:'franc-min'});});});
describe('shared page-language arbitration',()=>{
  const french='Cette page synthétique présente une œuvre traduite en français. Les lectrices et lecteurs peuvent y découvrir les chapitres récemment publiés, consulter une description complète et suivre les nouvelles parutions dans une langue naturelle et clairement identifiable.';
  it('overrides generic English theme declarations with reliable French content',()=>{
    const result=resolvePageLanguage({url:'https://synthetic.invalid/work',html:`<html lang="en-US"><head><meta property="og:locale" content="en_US"></head><body><main>${french}</main></body></html>`,now:'2026-08-10T00:00:00.000Z'});
    expect(result).toMatchObject({language:'fr',method:'statistical',evidence:{declarations:[expect.objectContaining({method:'html-lang',language:'en-US'}),expect.objectContaining({method:'og:locale',language:'en-US'})],detectors:{francMin:expect.objectContaining({language:'fr',reliable:true}),eld:expect.objectContaining({language:'fr',reliable:true})}}});
    expect(result.evidence.analyzedLength).toBe(french.length);
  });
  it.each([
    [{url:'https://synthetic.invalid/work',headers:{'content-language':'en'},html:`<body>${french}</body>`},'content-language'],
    [{url:'https://synthetic.invalid/en/work',html:`<body>${french}</body>`},'url-path'],
  ])('rejects reliable statistical disagreement with a strong %s signal',(input,strongMethod)=>{
    const result=resolvePageLanguage(input);
    expect(result).toMatchObject({language:null,method:'ambiguous'});
    expect(result.evidence.declarations).toEqual(expect.arrayContaining([expect.objectContaining({method:strongMethod,strength:'strong'})]));
    expect(result.evidence.conflicts).toEqual(expect.arrayContaining([expect.objectContaining({kind:'strong-statistical',languages:['en','fr']})]));
  });
  it('keeps coherent weak declarations when visible text is too short',()=>{
    expect(resolvePageLanguage({url:'https://synthetic.invalid/work',manifestLanguage:'fr-FR',html:'<html lang="fr"><body>Court.</body></html>'})).toMatchObject({language:'fr-FR',method:'manifest',evidence:{analyzedLength:6}});
  });
  it('records conflicting weak declarations and remains ambiguous without reliable content',()=>{
    expect(resolvePageLanguage({url:'https://synthetic.invalid/work',html:'<html lang="en"><head><meta property="og:locale" content="fr_FR"></head><body>Court.</body></html>'})).toMatchObject({language:null,method:'ambiguous',evidence:{conflicts:[expect.objectContaining({kind:'weak-weak'})]}});
  });
});
