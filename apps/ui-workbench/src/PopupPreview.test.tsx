import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('Popup preview', () => {
  it('navigates the three panels without leaving the extension shell', () => {
    render(<App />);

    fireEvent.change(screen.getByPlaceholderText('Rechercher…'), { target: { value: 'Menu extension' } });
    fireEvent.click(screen.getByRole('button', { name: 'Menu extension' }));

    expect(screen.getByRole('tabpanel', { name: 'Œuvre' })).toBeTruthy();
    expect(screen.getByText('Les Carnets de l’Apothicaire')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Œuvre' }).getAttribute('aria-controls')).toBe('popup-page-panel');
    expect(screen.getByRole('tabpanel', { name: 'Œuvre' }).getAttribute('aria-labelledby')).toBe('popup-page-tab');
    const sortiesTab = screen.getByRole('tab', { name: 'Sorties' });
    fireEvent.click(sortiesTab);
    expect(screen.getByRole('tabpanel', { name: 'Sorties' })).toBeTruthy();
    expect(screen.getByText('Dandadan')).toBeTruthy();

    const settingsTab = screen.getByRole('tab', { name: 'Réglages' });
    fireEvent.keyDown(sortiesTab, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(settingsTab);
    fireEvent.click(settingsTab);
    expect(screen.getByRole('tabpanel', { name: 'Réglages' })).toBeTruthy();
    const observation = screen.getByRole('switch', { name: 'Observer la navigation' });
    expect(observation.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(observation);
    expect(observation.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('button', { name: 'Ouvrir les réglages complets' })).toBeTruthy();
  });
});
