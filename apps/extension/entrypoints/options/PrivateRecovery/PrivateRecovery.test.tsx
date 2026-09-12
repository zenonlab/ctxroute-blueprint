// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PrivateRecovery } from './index';

afterEach(cleanup);

describe('private recovery settings', () => {
  it('requires matching export phrases and explicit restore confirmation', () => {
    const onExport = vi.fn();
    const onRestore = vi.fn();
    render(<PrivateRecovery onExport={onExport} onRestore={onRestore} state="idle" />);
    const exportButton = screen.getByRole('button', { name: 'Télécharger la sauvegarde' });
    fireEvent.change(screen.getByLabelText('Phrase secrète, 12 caractères minimum'), { target: { value: 'phrase-secrete-solide' } });
    fireEvent.change(screen.getByLabelText('Confirmer la phrase secrète'), { target: { value: 'phrase-secrete-solide' } });
    fireEvent.click(exportButton);
    expect(onExport).toHaveBeenCalledExactlyOnceWith('phrase-secrete-solide');

    const restoreButton = screen.getByRole('button', { name: 'Restaurer cette sauvegarde' });
    const file = new File(['{}'], 'backup.tobirink', { type: 'application/json' });
    fireEvent.change(screen.getByLabelText('Archive TobiRink'), { target: { files: [file] } });
    fireEvent.change(screen.getByLabelText('Phrase secrète de l’archive'), { target: { value: 'phrase-secrete-solide' } });
    expect(restoreButton.hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(restoreButton);
    expect(onRestore).toHaveBeenCalledExactlyOnceWith(file, 'phrase-secrete-solide');
  });

  it('announces failure without claiming that local state was replaced', () => {
    render(<PrivateRecovery onExport={vi.fn()} onRestore={vi.fn()} state="error" />);
    expect(screen.getByRole('status').textContent).toContain('reste intact');
  });
});
