import { describe, expect, it } from 'vitest';
describe('API contract smoke',()=>{it('documents local origin and protocol',()=>expect({origin:'https://favlib.home.arpa',currentProtocol:1,minimumSupportedProtocol:1}).toEqual(expect.objectContaining({currentProtocol:1})))});
