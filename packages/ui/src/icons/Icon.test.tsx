import { describe, expect, it } from 'vitest';
import { Icon, iconNames, iconSizes } from '../index';

describe('Icon', () => {
  it('keeps the initial source and size sets bounded', () => {
    expect(iconNames).toHaveLength(38);
    expect(new Set(iconNames).size).toBe(iconNames.length);
    expect(iconNames).toEqual(expect.arrayContaining([
      'calendar-days',
      'folder-tree',
      'library-big',
      'loader-circle',
      'radio',
      'search',
      'settings-2',
      'swords',
    ]));
    expect(iconSizes).toEqual(['sm', 'md', 'lg']);
  });

  it('hides a decorative icon from assistive technology', () => {
    const icon = Icon({ name: 'check' });
    expect(icon.props['aria-hidden']).toBe(true);
    expect(icon.props.role).toBeUndefined();
  });

  it('labels an informative icon', () => {
    const icon = Icon({ label: 'Rechercher', name: 'search', size: 'lg' });
    expect(icon.props['aria-label']).toBe('Rechercher');
    expect(icon.props['data-size']).toBe('lg');
    expect(icon.props.role).toBe('img');
  });

  it('renders a contrasted sibling priority inside a filled folder SVG only', () => {
    const folder = Icon({ folderPriority: 12, name: 'folder' });
    const search = Icon({ folderPriority: 3, name: 'search' });

    expect(folder.props['data-folder-priority']).toBe('true');
    expect(folder.props.children.props.children).toBe('12');
    expect(folder.props.children.props.x).toBe('12');
    expect(folder.props.children.props.y).toBe('16');
    expect(search.props['data-folder-priority']).toBeUndefined();
    expect(search.props.children).toBeNull();
  });
});
