import type { PreviewCategory, PreviewLevel } from '@tobirink/ui/preview-contract';
import type { CatalogueItem } from './types';

interface PlannedDefinition {
  category: PreviewCategory;
  id: string;
  level: PreviewLevel;
  purpose: string;
  title: string;
}

const definitions: readonly PlannedDefinition[] = [
  { id: 'colors-contrast', title: 'Couleurs & contraste', category: 'Fondations', level: 'foundation', purpose: 'Fixer la palette sémantique et ses contrastes.' },
  { id: 'typography-spacing', title: 'Typographie & espacements', category: 'Fondations', level: 'foundation', purpose: 'Installer rythme, hiérarchie et densité.' },
  { id: 'shape-elevation-motion', title: 'Forme, élévation & mouvement', category: 'Fondations', level: 'foundation', purpose: 'Unifier profondeur, silhouette et transitions.' },
  { id: 'icons', title: 'Icônes', category: 'Fondations', level: 'foundation', purpose: 'Fixer une source SVG locale et une convention unique.' },
  { id: 'button', title: 'Button', category: 'Primitives', level: 'primitive', purpose: 'Déclencher une action explicite.' },
  { id: 'search-field', title: 'SearchField', category: 'Primitives', level: 'primitive', purpose: 'Rechercher avec un contrôle compact dédié.' },
  { id: 'facet-select', title: 'FacetSelect', category: 'Primitives', level: 'primitive', purpose: 'Inclure, exclure ou neutraliser plusieurs facettes.' },
  { id: 'switch', title: 'Switch', category: 'Primitives', level: 'primitive', purpose: 'Basculer un réglage immédiatement.' },
  { id: 'status', title: 'Status', category: 'Primitives', level: 'primitive', purpose: 'Exprimer un état sans devenir une action.' },
  { id: 'surface', title: 'Surface', category: 'Primitives', level: 'primitive', purpose: 'Regrouper du contenu selon une hiérarchie stable.' },
  { id: 'dialog', title: 'Dialog', category: 'Primitives', level: 'primitive', purpose: 'Concentrer une décision temporaire.' },
  { id: 'navigation', title: 'Navigation', category: 'Primitives', level: 'primitive', purpose: 'Se déplacer entre les surfaces principales.' },
  { id: 'feedback-states', title: 'Loading, Empty & Error', category: 'Primitives', level: 'primitive', purpose: 'Expliquer chaque état non nominal.' },
  { id: 'work-card', title: 'WorkCard', category: 'Métier', level: 'domain', purpose: 'Résumer une œuvre et sa progression.' },
  { id: 'member-navigation', title: 'Shell membre', category: 'Surfaces', level: 'surface', purpose: 'Encadrer les pages avec navigation, recherche et resolver Review.' },
  { id: 'library-filters', title: 'Recherche & filtres', category: 'Métier', level: 'domain', purpose: 'Réduire une bibliothèque sans perdre le contexte.' },
  { id: 'popup', title: 'Menu extension', category: 'Surfaces', level: 'surface', purpose: 'Ouvrir rapidement une surface depuis la barre du navigateur.' },
  { id: 'library', title: 'Bibliothèque', category: 'Surfaces', level: 'surface', purpose: 'Parcourir la collection privée faisant autorité.' },
  { id: 'review', title: 'Review', category: 'Surfaces', level: 'surface', purpose: 'Résoudre les éléments ambigus avec contrôle utilisateur.' },
  { id: 'agenda', title: 'Agenda', category: 'Surfaces', level: 'surface', purpose: 'Organiser les prochaines sorties et reprises.' },
  { id: 'settings', title: 'Réglages', category: 'Surfaces', level: 'surface', purpose: 'Configurer les comportements locaux et optionnels.' },
];

export const plannedCatalogue: readonly CatalogueItem[] = definitions.map((definition) => ({
  ...definition,
  accessibility: ['Structure sémantique à définir', 'Navigation clavier à vérifier'],
  dependencies: [],
  presentation: definition.id === 'popup' ? 'popup' : definition.level === 'surface' ? 'page' : 'component',
  states: ['default', 'focus', 'disabled'],
  status: 'planned',
  usage: `// ${definition.title} sera documenté avec son implémentation.`,
  variants: ['default'],
}));
