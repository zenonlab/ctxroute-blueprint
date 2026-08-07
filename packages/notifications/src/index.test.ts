import { describe, expect, it, vi } from 'vitest';
import { deliverNtfy, digest, ntfyMessage, ntfyUrl } from './index.js';

const item = (id: string, releaseKey = 'm1|episode|1') => ({ id, userId: 'u1', kind: 'RELEASE_AVAILABLE', releaseKey, payload: {}, createdAt: '2026-08-02T00:00:00Z' });
describe('notifications', () => {
  it('deduplicates a personal digest and validates ntfy topics', () => { expect(digest([item('1'), item('2'), item('3','m1|episode|2')])).toHaveLength(2); expect(ntfyUrl('favlib_u1')).toBe('https://ntfy.sh/'); expect(() => ntfyUrl('bad/topic')).toThrow('INVALID_NTFY_TOPIC'); expect(() => ntfyUrl('favlib_u1','https://evil.test')).toThrow('NTFY_HOST_NOT_ALLOWED'); expect(() => ntfyUrl('favlib_u1','http://ntfy.sh')).toThrow('NTFY_HOST_NOT_ALLOWED'); expect(() => ntfyUrl('favlib_u1','https://ntfy.sh.evil.test')).toThrow('NTFY_HOST_NOT_ALLOWED'); });
  it('publishes conforming JSON only through the fixed HTTPS ntfy root', async () => { const fetcher = vi.fn(async (_input:RequestInfo|URL,_init?:RequestInit) => new Response('', { status: 200 })); await deliverNtfy('favlib_u1', [item('1')], fetcher); expect(fetcher).toHaveBeenCalledWith('https://ntfy.sh/', expect.objectContaining({ method: 'POST' }));const payload=JSON.parse(String(fetcher.mock.calls[0][1]?.body));expect(payload).toMatchObject({topic:'favlib_u1',title:'FavLib — nouvelles sorties',tags:['books']});expect(payload.sequence_id).toHaveLength(64); });
  it('summarizes after twenty items and stays within 3500 UTF-8 bytes',()=>{const items=Array.from({length:25},(_,index)=>item(String(index),`sortie-${index}`));const message=ntfyMessage(items);expect(message).toContain('+5 autres');expect(Buffer.byteLength(message)).toBeLessThanOrEqual(3500)});
});
