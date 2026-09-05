import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { feedbackStateLayouts, feedbackStateStates, feedbackStateVariants } from './index';

const component = readFileSync(new URL('./FeedbackState.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('./FeedbackState.module.css', import.meta.url), 'utf8');
const preview = readFileSync(new URL('./FeedbackState.preview.tsx', import.meta.url), 'utf8');

describe('FeedbackState', () => {
  it('bounds the three variants and preview states', () => {
    expect(feedbackStateVariants).toEqual(['loading', 'empty', 'error']);
    expect(feedbackStateStates).toEqual(['default', 'recoverable']);
    expect(feedbackStateLayouts).toEqual(['inline', 'centered']);
  });

  it('announces loading and empty politely, and errors immediately', () => {
    expect(component).toMatch(/role=\{kind === 'error' \? 'alert' : 'status'\}/);
    expect(component).toMatch(/aria-live=\{kind === 'error' \? 'assertive' : 'polite'\}/);
    expect(component).toMatch(/aria-busy=\{kind === 'loading' \|\| undefined\}/);
  });

  it('uses shared Lucide icons for every state', () => {
    expect(component).toMatch(/empty: 'inbox'/);
    expect(component).toMatch(/error: 'circle-alert'/);
    expect(component).toMatch(/loading: 'loader-circle'/);
  });

  it('renders an action for empty states and explicitly recoverable errors', () => {
    expect(component).toMatch(/kind === 'empty' \|\| recoverable === true/);
    expect(component).toMatch(/showAction \? <div className=\{styles\.action\}>\{action\}<\/div> : null/);
    expect(component).toMatch(/interface EmptyFeedbackStateProps[\s\S]*action\?: ReactNode/);
  });

  it('provides a containerless centered surface with a large muted Lucide icon', () => {
    expect(component).toMatch(/layout = 'inline'/);
    expect(component).toMatch(/data-layout=\{layout\}/);
    expect(component).toMatch(/icon \?\? iconByKind\[kind\]/);
    expect(css).toMatch(/\.centered[\s\S]*text-align: center/);
    expect(css).toMatch(/\.centered \{[\s\S]*background: transparent;[\s\S]*border: 0;[\s\S]*padding: 0;/);
    expect(css).toMatch(/\.centered \.icon \{[\s\S]*color: var\(--color-text-subtle\)/);
    expect(css).toMatch(/\.centered \.icon svg \{[\s\S]*var\(--icon-size-lg\) \* 2/);
  });

  it('uses tokens and disables loading motion when reduced motion is requested', () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/gi);
    expect(css).toMatch(/prefers-reduced-motion: reduce/);
    expect(css).toMatch(/\.loading \.icon \{\s*animation: none;/);
  });

  it('publishes the isolated workbench preview', () => {
    expect(preview).toMatch(/id: 'feedback-states'/);
    expect(preview).toMatch(/selectedVariant === 'error' && selectedState === 'recoverable'/);
    expect(preview).toMatch(/components\/feedback-state\/FeedbackState\.tsx/);
  });
});
