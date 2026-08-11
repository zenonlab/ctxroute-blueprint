import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';

const server=readFileSync(new URL('../src/server.ts',import.meta.url),'utf8');
const reviewRoute=server.slice(server.indexOf('app.post("/api/v1/reviews/:id/report"'),server.indexOf('app.post("/api/v1/revalidations/:id/skip"'));
const adminRoutes=server.slice(server.indexOf("app.get('/api/v1/admin/warnings'"),server.indexOf('app.get("/api/v1/admin/metrics"'));

describe('admin-authoritative report routes',()=>{
  it('routes legacy identity reports into pending adjudication without quorum suspension',()=>{expect(reviewRoute).toContain('submitAdjudicatedReport');expect(reviewRoute).toContain("status:'PENDING'");expect(reviewRoute).not.toContain("state='SUSPENDED'");expect(reviewRoute).not.toContain('quorum')});
  it('keeps legacy dead links as automated health feedback',()=>{expect(server).toContain("classification:'AUTOMATED_HEALTH_FEEDBACK'");expect(server).toContain("parsed.data.reason==='DEAD_LINK'")});
  it('enforces admin authorization, revision binding, preview, audit and reversion',()=>{expect(adminRoutes.match(/req\.user\.role!=='admin'/g)?.length).toBeGreaterThanOrEqual(5);expect(adminRoutes).toContain('EVIDENCE_REVISION_CHANGED');expect(adminRoutes).toContain('affectedActiveFavorites');expect(adminRoutes).toContain('report_case_audit_event');expect(adminRoutes).toContain("status='REVERTED'")});
  it('never blocks a whole domain and keeps extension-private decisions user scoped',()=>{expect(adminRoutes).toContain('canonical_url');expect(adminRoutes).toContain("accessMode==='extension_private'");expect(adminRoutes).not.toMatch(/UPDATE\s+approved_site/i);expect(adminRoutes).not.toMatch(/BLOCK[^\n]*domain/i)});
});
