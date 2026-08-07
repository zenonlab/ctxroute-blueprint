import { describe, expect, it } from 'vitest';
import { acceptObservation, chapterDisplay, comparePosition, consolidate, greatestAvailable, normalizeSerializationStatus, position } from './index.js';

const high = (raw: string, observedAt = '2026-01-01T00:00:00Z') => ({ mediaId: 'm1', source: 'fixture', position: position(raw), confidence: 'high' as const, observedAt, consented: true });

describe('progression', () => {
  it('normalizes only explicit provider statuses and preserves unknown values',()=>{
    expect(normalizeSerializationStatus('RELEASING')).toBe('Ongoing');
    expect(normalizeSerializationStatus('On Hiatus')).toBe('Hiatus');
    expect(normalizeSerializationStatus('Finished')).toBe('Completed');
    expect(normalizeSerializationStatus(undefined)).toBeUndefined();
    expect(normalizeSerializationStatus('Cancelled')).toBeUndefined();
  });

  it('keeps decimal raw provenance and never regresses provider availability',()=>{
    const current={...position('12.5','chapter'),kind:'chapter' as const,provenance:{source:'record'}};
    const older={...position('11','chapter'),kind:'chapter' as const,provenance:{source:'feed'}};
    expect(greatestAvailable(current,older)).toEqual(current);
    expect(current.raw).toBe('12.5');
  });
  it('accepts a numeric provider position without losing its raw representation',()=>{
    expect(position(153, 'chapter')).toEqual({kind:'chapter',number:153,raw:'153'});
  });
  it('formats synthetic provider variants while preserving raw input',()=>{
    for(const [raw,display] of [['c.58','Chapitre 58'],['ch.58','Chapitre 58'],['58.5','Chapitre 58.5']] as const){
      expect(position(raw,'chapter').raw).toBe(raw);
      expect(chapterDisplay(raw)).toBe(display);
    }
    expect(chapterDisplay('Special Extra')).toBe('Special Extra');
    expect(position('v.4 c.58','chapter').raw).toBe('v.4 c.58');
  });
  it('advances only within the same ordered sequence', () => {
    expect(acceptObservation(position('11'), high('12'))).toBe(true);
    expect(acceptObservation(position('12'), high('11'))).toBe(false);
    expect(comparePosition(position('12'), position('12'))).toBe(0);
  });
  it('rejects unconsented, low-confidence and special observations', () => {
    expect(acceptObservation(null, { ...high('12'), consented: false })).toBe(false);
    expect(acceptObservation(null, { ...high('12'), confidence: 'low' })).toBe(false);
    expect(acceptObservation(null, high('SP-3'))).toBe(false);
  });
  it('consolidates identical positions and keeps the newest observation', () => {
    expect(consolidate([high('11'), high('11', '2026-01-02T00:00:00Z'), high('12')])).toHaveLength(2);
    expect(consolidate([high('11'), high('11', '2026-01-02T00:00:00Z')])[0].observedAt).toContain('2026-01-02');
  });
});
