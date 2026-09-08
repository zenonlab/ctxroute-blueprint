// @vitest-environment jsdom
import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CollectiveSettings } from './index';

afterEach(cleanup);
describe('collective consent settings', () => {
  it('requires unchecked explicit consent before enabling or pairing', () => {
    const onEnable = vi.fn();
    render(<CollectiveSettings busy={false} error={false} onEnable={onEnable} onPair={vi.fn()} onRedeem={vi.fn()} onRevoke={vi.fn()} status="disabled" />);
    const button = screen.getByRole('button', { name: 'Activer le collectif' });
    expect(button.hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(button);
    expect(onEnable).toHaveBeenCalledOnce();
  });
  it('announces errors and disables operations while a request is pending', () => {
    render(<CollectiveSettings busy error onEnable={vi.fn()} onPair={vi.fn()} onRedeem={vi.fn()} onRevoke={vi.fn()} status="enabled" />);
    expect(screen.getByRole('alert').textContent).toContain('Réessayez');
    expect(screen.getAllByRole('button').every((button) => button.hasAttribute('disabled'))).toBe(true);
  });
});
