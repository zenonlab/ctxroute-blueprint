import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Bell,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  CircleAlert,
  Download,
  FileText,
  Folder,
  FolderPlus,
  FolderTree,
  Ghost,
  GripVertical,
  Heart,
  House,
  Inbox,
  LibraryBig,
  LoaderCircle,
  Pause,
  Pencil,
  Play,
  Plus,
  Puzzle,
  Radio,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  Settings2,
  Smile,
  Swords,
  Trash2,
  X,
} from 'lucide-react';
import type { LucideIcon, LucideProps } from 'lucide-react';
import './icon.css';

export const iconNames = [
  'arrow-down',
  'arrow-left',
  'arrow-right',
  'bell',
  'calendar-days',
  'check',
  'chevron-down',
  'chevron-left',
  'chevron-right',
  'circle',
  'circle-alert',
  'download',
  'file-text',
  'folder',
  'folder-plus',
  'folder-tree',
  'ghost',
  'grip-vertical',
  'heart',
  'house',
  'inbox',
  'library-big',
  'loader-circle',
  'pause',
  'pencil',
  'play',
  'plus',
  'puzzle',
  'radio',
  'refresh-cw',
  'rotate-ccw',
  'search',
  'settings',
  'settings-2',
  'smile',
  'swords',
  'trash-2',
  'x',
] as const;
export const iconSizes = ['sm', 'md', 'lg'] as const;

export type IconName = (typeof iconNames)[number];
export type IconSize = (typeof iconSizes)[number];

export interface IconProps extends Omit<LucideProps, 'absoluteStrokeWidth' | 'children' | 'size' | 'strokeWidth'> {
  folderPriority?: number;
  label?: string;
  name: IconName;
  size?: IconSize;
}

const icons = {
  'arrow-down': ArrowDown,
  'arrow-left': ArrowLeft,
  'arrow-right': ArrowRight,
  bell: Bell,
  'calendar-days': CalendarDays,
  check: Check,
  'chevron-down': ChevronDown,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  circle: Circle,
  'circle-alert': CircleAlert,
  download: Download,
  'file-text': FileText,
  folder: Folder,
  'folder-plus': FolderPlus,
  'folder-tree': FolderTree,
  ghost: Ghost,
  'grip-vertical': GripVertical,
  heart: Heart,
  house: House,
  inbox: Inbox,
  'library-big': LibraryBig,
  'loader-circle': LoaderCircle,
  pause: Pause,
  pencil: Pencil,
  play: Play,
  plus: Plus,
  puzzle: Puzzle,
  radio: Radio,
  'refresh-cw': RefreshCw,
  'rotate-ccw': RotateCcw,
  search: Search,
  settings: Settings,
  'settings-2': Settings2,
  smile: Smile,
  swords: Swords,
  'trash-2': Trash2,
  x: X,
} satisfies Record<IconName, LucideIcon>;

export function Icon({ className, folderPriority, label, name, size = 'md', ...props }: IconProps) {
  const classes = ['ui-icon', className].filter(Boolean).join(' ');
  const Glyph = icons[name];
  const priority = name === 'folder' && Number.isInteger(folderPriority) && Number(folderPriority) > 0
    ? String(folderPriority)
    : undefined;

  return (
    <Glyph
      {...props}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      className={classes}
      data-folder-priority={priority ? 'true' : undefined}
      data-size={size}
      focusable="false"
      role={label ? 'img' : undefined}
    >
      {priority ? <text aria-hidden="true" className="ui-icon__priority" x="12" y="16">{priority}</text> : null}
    </Glyph>
  );
}
