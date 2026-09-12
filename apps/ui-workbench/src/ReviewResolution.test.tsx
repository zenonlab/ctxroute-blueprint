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

  it('keeps arrow navigation and omits technical ambiguity and defer copy', () => {
    const submit = vi.fn();
    const previous = vi.fn();
    const next = vi.fn();
    render(<ReviewResolver canNext canPrevious item={{ candidates: [], id: 'review_synthetic', reason: 'AMBIGUOUS', revision: 'revision-2', sourceLabel: 'Favori', title: 'Synthetic voyager' }} onNext={next} onPrevious={previous} onRefresh={vi.fn()} onRetry={vi.fn()} onSubmitDecision={submit} state="ready" />);
    expect(screen.queryByText('Plusieurs identités ou preuves contradictoires')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reporter de 24 heures' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Review précédente' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review suivante' }));
    expect(previous).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledOnce();
  });
});
