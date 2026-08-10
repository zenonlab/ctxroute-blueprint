import { describe,expect,it } from 'vitest';
import { contentPreferenceContract,contentPreferencePatchContract } from './index.js';
import { openApiDocument } from './openapi.js';

describe('content preference contract',()=>{
  it('keeps a strict boolean opt-in disabled by the API default rather than coercing user input',()=>{
    expect(contentPreferenceContract.parse({allowAdult:false,updatedAt:null})).toEqual({allowAdult:false,updatedAt:null});
    expect(contentPreferencePatchContract.safeParse({allowAdult:true}).success).toBe(true);
    expect(contentPreferencePatchContract.safeParse({allowAdult:'true'}).success).toBe(false);
    expect(contentPreferencePatchContract.safeParse({allowAdult:true,userId:'bob'}).success).toBe(false);
  });

  it('documents the PATCH body in OpenAPI',()=>{
    expect(openApiDocument.paths['/api/v1/preferences/content'].patch.requestBody).toBeDefined();
  });
});
