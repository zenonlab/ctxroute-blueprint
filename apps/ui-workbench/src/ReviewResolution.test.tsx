import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReviewResolver } from '@tobirink/ui';

afterEach(cleanup);

describe('Actionable Review decisions', () => {
  it('keeps NOT_FOUND actionable, validates manual input, and requires an explicit no-match confirmation', () => {
    const submit = vi.fn();
    render(<ReviewResolver canNext={false} canPrevious={false} item={{ candidates: [], id: 'review_synthetic', reason: 'NOT_FOUND', revision: 'revision-1', sourceLabel: 'Favori', title: 'Synthetic voyager' }} onNext={vi.fn()} onPrevious={vi.fn()} onRefresh={vi.fn()} onRetry={vi.fn()} onSubmitDecision={submit} state="partial" />);
    expect(screen.getByText('Aucune identité trouvée après recherche complète')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Saisir un identifiant ou une URL' }));
    fireEvent.click(screen.getByRole('button', { name: 'Vérifier' }));
    expect(screen.getByRole('alert').textContent).toContain('Saisissez');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'anilist:123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Vérifier' }));
    expect(submit).toHaveBeenLastCalledWith({ kind: 'manual', revision: 'revision-1', source: 'id', value: 'anilist:123' });
    submit.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Aucune correspondance', exact: true }));
    expect(submit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer aucune correspondance', exact: true }));
    expect(submit).toHaveBeenCalledWith({ kind: 'none', revision: 'revision-1' });
  });

  it('can defer the last Review without resolving it', () => {
    const submit = vi.fn();
    render(<ReviewResolver canNext={false} canPrevious={false} item={{ candidates: [], id: 'review_synthetic', reason: 'AMBIGUOUS', revision: 'revision-2', sourceLabel: 'Favori', title: 'Synthetic voyager' }} onNext={vi.fn()} onPrevious={vi.fn()} onRefresh={vi.fn()} onRetry={vi.fn()} onSubmitDecision={submit} state="ready" />);
    fireEvent.click(screen.getByRole('button', { name: 'Reporter de 24 heures' }));
    expect(submit).toHaveBeenCalledWith({ kind: 'defer', revision: 'revision-2' });
  });
});
