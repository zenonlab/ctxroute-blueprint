import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseFavorite, sourceIdentityFromUrl } from '@favlib/metadata';
import { importIdentityFromArtifact } from '../src/import-identity.js';

const server=readFileSync(resolve(process.cwd(),'src/server.ts'),'utf8');

describe('API shared parser ingestion',()=>{
  it('stores the current parse result instead of retaining a larger obsolete technical id',()=>{
    expect(server).toContain('position_number=excluded.position_number');
    expect(server).toContain('position_raw=excluded.position_raw');
    expect(server).not.toContain('GREATEST(favorite_progress_candidate.position_number,excluded.position_number)');
    expect(server).toContain('DELETE FROM favorite_progress_candidate WHERE user_id=$1 AND installation_id=$2 AND bookmark_id=$3');
  });

  it('classifies from the v9 artifact and ignores any client title hint',()=>{
    const raw={title:'Synthetic Quartz Registry - Chapter 17',url:'https://reader.invalid/series/node-qp731904/chapter-17'};
    const artifact=parseFavorite({...raw,source:{title:'Node Qp731904',slug:'node-qp731904',rawSlug:'node-qp731904',canonicalUrl:'https://reader.invalid/series/node-qp731904',type:'MANGA',strategy:'adapter',evidence:['CATEGORY_PATH']}});
    expect(importIdentityFromArtifact(artifact,raw.url)).toMatchObject({status:'recognized',reason:'URL_IDENTITY_ADAPTER',identity:{title:'Synthetic Quartz Registry',rawSlug:'node-qp731904'}});
  });

  it('keeps an opaque artifact without human corroboration in review',()=>{
    const raw={title:'Chapter 17',url:'https://reader.invalid/series/node-qp731904/chapter-17'};
    const artifact=parseFavorite({...raw,source:{title:'Node Qp731904',slug:'node-qp731904',rawSlug:'node-qp731904',type:'MANGA'}});
    expect(importIdentityFromArtifact(artifact,raw.url)).toEqual({status:'review',reason:'OPAQUE_IDENTITY_UNCORROBORATED',identity:null});
  });

  it('keeps the slug identity when a favorite label only describes a special chapter',()=>{
    const raw={title:'Ch 2 Special',url:'https://reader.invalid/series/synthetic-copper-index/chapter-2-special'};
    const source=sourceIdentityFromUrl(raw.url);
    expect(source).toMatchObject({title:'Synthetic Copper Index',slug:'synthetic-copper-index'});
    const artifact=parseFavorite({...raw,source});
    expect(importIdentityFromArtifact(artifact,raw.url)).toMatchObject({status:'recognized',identity:{title:'Synthetic Copper Index'}});
    expect(artifact.displayTitle).toBe('Synthetic Copper Index');
  });
});
