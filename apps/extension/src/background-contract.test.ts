import { describe,expect,it } from 'vitest';
import { readFileSync } from 'node:fs';

const background=readFileSync(new URL('../entrypoints/background.ts',import.meta.url),'utf8');

describe('background startup contract',()=>{
  it('uses the normal sync pass as the sole installation inventory reconciliation',()=>{
    const installed=background.match(/chrome\.runtime\.onInstalled\.addListener\(async \(\) => \{([\s\S]*?)\n  \}\);/)?.[1]??'';
    expect(installed).toContain('await requestSync(true)');
    expect(installed).not.toContain('reconcileInventory(');
    expect(background.match(/reconciled=await reconcileInventory\(state\)/g)).toHaveLength(1);
  });
  it('returns before networking when the periodic local comparison has no events',()=>{
    const scan=background.slice(background.indexOf('const sync = createSyncDrain'),background.indexOf('const requestSync='));
    expect(scan.indexOf('reconcileInventory(state)')).toBeLessThan(scan.indexOf('synchronizeExtensionControl(state)'));
    expect(scan).toContain('const snapshotChanged=inventorySnapshotChanged(state,reconciled)');
    expect(scan).toContain('if(snapshotChanged)state=await updateState');
    expect(scan).toContain('const rebuilt=rebuildImportQueue');
    expect(scan).toContain('state=await updateState(current=>mergeReconciledState(current,rebuilt))');
    expect(scan).toContain('if(!state.queue.length)return');
    expect(background).toContain("else if(alarm.name==='favlib-sync')void requestSync()");
  });
});
