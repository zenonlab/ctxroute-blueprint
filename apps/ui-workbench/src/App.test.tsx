import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from './App';

const catalogueSearch = () => within(screen.getByLabelText('Catalogue des composants')).getByPlaceholderText('Rechercher…');

describe('UI workbench', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('navigates the complete plan and renders the matching preview', () => {
    render(<App />);

    expect(screen.getByLabelText('24 éléments')).toBeTruthy();
    fireEvent.change(catalogueSearch(), { target: { value: 'Review' } });
    fireEvent.click(screen.getByRole('button', { name: 'Panneau Review' }));

    expect(screen.getByRole('heading', { name: 'Panneau Review', level: 2 })).toBeTruthy();
    expect(screen.getByLabelText('Aperçu de Panneau Review')).toBeTruthy();
    expect(screen.queryByLabelText('Code source')).toBeNull();
    expect(window.location.hash).toBe('#review');
  });

  it('opens a valid deep link and exposes functional viewport controls', () => {
    window.history.replaceState(null, '', '/#work-card');
    render(<App />);

    expect(screen.getByRole('heading', { name: 'WorkCard', level: 2 })).toBeTruthy();
    const automatic = screen.getByRole('button', { name: 'Auto' });
    const narrow = screen.getByRole('button', { name: '390' });
    const tablet = screen.getByRole('button', { name: '768' });
    expect(automatic.getAttribute('aria-pressed')).toBe('true');
    expect(narrow.hasAttribute('disabled')).toBe(false);
    expect(tablet.hasAttribute('disabled')).toBe(false);

    fireEvent.click(narrow);
    expect(narrow.getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('.canvas__render')?.getAttribute('data-viewport')).toBe('390');
    fireEvent.click(tablet);
    expect(tablet.getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('.canvas__render')?.getAttribute('data-viewport')).toBe('768');
  });

  it('distinguishes page and popup presentations without nesting the workbench landmark', () => {
    render(<App />);

    fireEvent.change(catalogueSearch(), { target: { value: 'Réglages complets' } });
    fireEvent.click(screen.getByRole('button', { name: 'Réglages complets' }));
    expect(screen.getByLabelText('Aperçu de Réglages complets').getAttribute('data-presentation')).toBe('page');
    expect(document.querySelector('.preview-pane')?.tagName).toBe('SECTION');
    expect(document.querySelector('.preview-pane main main')).toBeNull();

    fireEvent.change(catalogueSearch(), { target: { value: 'Menu extension' } });
    fireEvent.click(screen.getByRole('button', { name: 'Menu extension' }));
    expect(screen.getByLabelText('Aperçu de Menu extension').getAttribute('data-presentation')).toBe('popup');
  });

  it('switches only between catalogue and preview on compact layouts', () => {
    render(<App />);

    expect(screen.queryByRole('button', { name: 'Code' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Tout' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Aperçu' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Catalogue' }));
    expect(screen.getByRole('button', { name: 'Catalogue' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByLabelText('Catalogue des composants').closest('.pane')?.className).toContain('is-mobile-active');
  });

  it('renders the Agenda and Review fixtures inside the WorkCard module', () => {
    render(<App />);

    fireEvent.change(catalogueSearch(), { target: { value: 'WorkCard' } });
    fireEvent.click(screen.getByRole('button', { name: 'WorkCard' }));
    const variant = screen.getByLabelText('Variante');

    fireEvent.change(variant, { target: { value: 'agenda' } });
    expect(screen.getByText('Officielle')).toBeTruthy();
    expect(screen.getByText('5 sept.')).toBeTruthy();
    expect(screen.getByText('Chapitre 141 · Éditeur')).toBeTruthy();

    fireEvent.change(variant, { target: { value: 'review' } });
    expect(screen.getByText('Candidat')).toBeTruthy();
    expect(screen.getByText('ANL 12345')).toBeTruthy();
    expect(screen.getByText('AniList')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sélectionner' }).getAttribute('aria-pressed')).toBe('false');
    const source = screen.getByRole('link', { name: 'Source de l’œuvre' });
    let sourceActivated = false;
    source.addEventListener('click', (event) => {
      event.preventDefault();
      sourceActivated = true;
    });
    fireEvent.click(source);
    expect(sourceActivated).toBe(true);
  });

  it('flips Review candidates and submits the FavLib decisions directly', () => {
    render(<App />);

    fireEvent.change(catalogueSearch(), { target: { value: 'Review' } });
    fireEvent.click(screen.getByRole('button', { name: 'Panneau Review' }));
    fireEvent.click(screen.getByRole('button', { name: 'Correspondances à vérifier' }));
    expect(screen.getByText('1 / 2')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Review précédente' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Passer cette Review pour le moment' }));
    expect(screen.getByText('2 / 2')).toBeTruthy();
    expect(screen.getByText('Frieren chapitre')).toBeTruthy();
    expect(screen.queryByText(/Décision prête/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Passer cette Review pour le moment' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Review précédente' }));
    expect(screen.getByText('1 / 2')).toBeTruthy();
    const candidates = screen.getAllByRole('group', { name: /Actions pour le candidat/ });
    const secondCandidate = candidates[1];
    const idleClassName = secondCandidate.className;

    fireEvent.pointerUp(secondCandidate, { pointerType: 'touch' });
    expect(secondCandidate.className).not.toBe(idleClassName);

    const select = within(secondCandidate).getByRole('button', { name: 'Choisir cette œuvre' });
    expect(select.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(select);
    expect(screen.getByText('Décision prête · candidate')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Confirmer la décision' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Saisir un identifiant ou une URL' }));
    fireEvent.change(screen.getByLabelText('Identifiant ou adresse de la source'), { target: { value: '30013' } });
    fireEvent.click(screen.getByRole('button', { name: 'Vérifier' }));
    expect(screen.getByText('Décision prête · manual')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Aucune correspondance' }));
    expect(screen.getByText('Décision prête · none')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('État'), { target: { value: 'conflict' } });
    fireEvent.click(screen.getByRole('button', { name: 'Correspondances à vérifier' }));
    expect(screen.getByRole('button', { name: 'Recharger' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Choisir cette œuvre' })).toBeNull();
  });

  it('renders the shared member navigation with global search and counted Review access', async () => {
    render(<App />);

    fireEvent.change(catalogueSearch(), { target: { value: 'Shell membre' } });
    fireEvent.click(screen.getByRole('button', { name: 'Shell membre' }));

    expect(screen.getByRole('navigation', { name: 'Navigation principale' })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Navigation mobile' })).toBeTruthy();
    const emptyReviewButton = screen.getByRole('button', { name: 'Correspondances à vérifier' });
    const searchForm = screen.getByRole('search', { name: 'Recherche globale' });
    expect(searchForm.nextElementSibling?.contains(emptyReviewButton)).toBe(true);
    expect(Array.from(emptyReviewButton.parentElement?.children ?? []).some((node) => node.tagName === 'SPAN' && node.getAttribute('aria-hidden') === 'true')).toBe(false);
    fireEvent.click(emptyReviewButton);
    const emptyReviewDialog = screen.getByRole('dialog', { name: 'Correspondances à vérifier' });
    expect(emptyReviewDialog.closest('header')).toBeTruthy();
    expect(screen.getByText('Aucune correspondance à vérifier')).toBeTruthy();
    expect(screen.queryByText('Toutes les correspondances ambiguës ont une décision locale.')).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Correspondances à vérifier' })).toBeNull();
    fireEvent.change(screen.getByRole('combobox', { name: 'État' }), { target: { value: 'reviews' } });
    expect(screen.getByText('3')).toBeTruthy();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Rechercher dans Tobirink' }), { target: { value: 'Frieren' } });
    fireEvent.submit(screen.getByRole('search', { name: 'Recherche globale' }));
    expect(screen.getByText('Recherche : Frieren')).toBeTruthy();

    const reviewButton = screen.getByRole('button', { name: 'Correspondances à vérifier' });
    fireEvent.click(reviewButton);
    const reviewDialog = screen.getByRole('dialog', { name: 'Correspondances à vérifier' });
    expect(reviewDialog).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(reviewDialog));
    const initialPosition = screen.getByText('1 / 3');
    expect(initialPosition.closest('nav')?.getAttribute('aria-label')).toBe('Navigation dans les Reviews');
    expect(screen.getByText('Carnets apothicaire')).toBeTruthy();

    expect(screen.getByRole('button', { name: 'Review précédente' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Passer cette Review pour le moment' }));
    expect(screen.getByText('2 / 3')).toBeTruthy();
    expect(screen.getByText('Review passée pour le moment')).toBeTruthy();
    expect(screen.queryByText(/Décision enregistrée/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Review précédente' }).hasAttribute('disabled')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Review précédente' }));
    expect(screen.getByText('1 / 3')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Saisir un identifiant ou une URL' }));
    fireEvent.change(screen.getByLabelText('Identifiant ou adresse de la source'), { target: { value: '30013' } });
    fireEvent.click(screen.getByRole('button', { name: 'Vérifier' }));
    expect(screen.getByText('Décision enregistrée : manual')).toBeTruthy();

    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog', { name: 'Correspondances à vérifier' })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(reviewButton));

  });
});
