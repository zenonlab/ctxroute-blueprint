import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source=readFileSync(join(process.cwd(),'app/favlib-app.tsx'),'utf8');
const styles=readFileSync(join(process.cwd(),'app/physical-card.css'),'utf8');
const physicalCard=readFileSync(join(process.cwd(),'app/physical-card.tsx'),'utf8');
const reportStyles=readFileSync(join(process.cwd(),'app/report-card.css'),'utf8');
const tiltStyles=readFileSync(join(process.cwd(),'app/card-tilt.css'),'utf8');
const motionFixes=readFileSync(join(process.cwd(),'app/physical-card-motion-fixes.css'),'utf8');
const cardBack=source.slice(source.indexOf('function MediaCardBack'),source.indexOf('function MediaCard('));

describe('refonte de la modal œuvre',()=>{
  it('sépare strictement les membres prouvés des autres relations',()=>{
    expect(cardBack).toContain("work.id===item.id||work.sequenceOrder!==null");
    expect(cardBack).toContain(".filter(work=>work.id!==item.id&&!sameWorkIds.has(work.id)).slice(0,24)");
    expect(cardBack).not.toContain('popularity');
    expect(cardBack).not.toContain('anilist.co');
  });
  it('affiche toutes les parties en liste et borne les découvertes à deux colonnes',()=>{
    expect(cardBack).toContain('sameWork.map(work=><RelatedWorkRow');
    expect(cardBack).not.toContain('sameWork.slice');
    expect(cardBack).toContain('discoveries.map(work=><RelatedWorkCard');
    expect(styles).toContain('.media-related-list{display:grid}');
    expect(styles).toContain('.media-discovery-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))');
    expect(styles).toContain('aspect-ratio:2/3');
  });
  it('remplace le détail dans la modal, le met en cache et conserve l’état courant en erreur',()=>{
    expect(cardBack).toContain('detailCache.current.get(work.id)');
    expect(cardBack).toContain('/related/${encodeURIComponent(work.id)}`');
    expect(cardBack).toContain("setTab('links')");
    expect(cardBack).toContain('Le contenu affiché reste inchangé.');
    expect(cardBack).toContain('aria-busy={loadingRelated}');
    expect(cardBack).toContain('aria-live="polite"');
  });
  it('réinitialise la session à la fermeture et ne rend aucun contrôle Fermer',()=>{
    expect(source).toContain('setSession(value=>value+1)');
    expect(physicalCard).toContain("event.key==='Escape'");
    expect(physicalCard).toContain("document.addEventListener('pointerdown',outside,true)");
    expect(physicalCard).toContain('trigger.current?.focus({preventScroll:true})');
    expect(physicalCard).not.toContain('>Fermer</button>');
  });
  it('restaure les onglets textuels et le sélecteur compact',()=>{
    expect(source).toContain("{id:'links',label:'Liens'}");
    expect(source).toContain("{id:'info',label:'Informations'}");
    expect(source).toContain("{id:'similar',label:'Découvertes'}");
    expect(source).not.toContain('<Layers');
    expect(cardBack).not.toContain('description,icon:Icon');
    expect(styles).toContain('.media-card-tabs button.active{color:var(--accent)}');
    expect(styles).toContain('.media-card-tabs button:hover,.media-card-tabs button:focus-visible{background:var(--surface-3)');
    expect(styles).toContain('.media-card-tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0');
    expect(styles).toContain('.related-work-row{display:grid');
    expect(source).toContain('<WorkHeaderIdentity work={item}/>');
    expect(source).toContain('<WorkHeaderIdentity work={work} showContext/>');
    expect(source).toContain("`Partie ${work.sequenceOrder===null?'—':work.sequenceOrder+1}`");
    expect(source).not.toContain('related-work-current">Active');
    expect(styles).toContain('.media-card-heading-kicker strong{color:var(--accent)');
    expect(styles).toContain('.media-source-row,.media-favorite-row,.media-card-stat-grid>div{padding:8px 0;border:0;background:transparent}');
    expect(styles).toContain('.icon-button{border:0;background:transparent}');
  });
  it('réutilise le DOM et les overlays des cartes de bibliothèque pour les découvertes',()=>{
    expect(source).toContain('className="related-work-card card media-card"');
    expect(source).toContain('<CardTopline item={work}/>');
    expect(source).toContain('className="poster-visual"');
    expect(styles).toContain('.related-work-card.card.media-card .poster');
  });
  it('préserve les recommandations d’œuvre, les favoris parsés et leurs actions',()=>{
    expect(source).toContain('recommendedSources.length');
    expect(source).toContain('favorite.parsedTitle');
    expect(source).toContain('source.workUrl??source.canonicalUrl');
    expect(source).toContain("fetch('/api/v1/reports'");
    expect(source).toContain('navigator.clipboard');
  });
  it('ajoute une seconde face sans couverture avec états complets, échappement et réduction de mouvement',()=>{
    expect(source).toContain('function ReportFace');
    expect(source).toContain('Avertissement envoyé à l’admin');
    expect(source).toContain('Session expirée');
    expect(source).toContain('Réessayer');
    expect(source).toContain('Aucun sujet vérifié ne peut être signalé');
    expect(source).toContain('data-report-trigger');
    expect(physicalCard).toContain('onEscape');
    expect(reportStyles).toContain('is-secondary-flipped .physical-card-rotor{animation:modal-report-turn');
    expect(reportStyles).toContain('@keyframes modal-report-turn');
    expect(reportStyles).toContain('@media(prefers-reduced-motion:reduce)');
    expect(source.slice(source.indexOf('function ReportFace'),source.indexOf('function MediaCardBack'))).not.toContain('<Cover');
  });
  it('garde la modal fixe et isole les cartes Découvertes',()=>{
    expect(physicalCard).not.toContain('interactiveHoverSelector');
    expect(physicalCard).not.toContain('modalFreezeBounds');
    expect(physicalCard).not.toContain("window.addEventListener('pointermove',track,true)");
    expect(physicalCard).not.toContain('onPointerOverCapture=');
    expect(physicalCard).not.toContain('--modal-tilt-');
    expect(styles).toContain('.physical-card.media-modal.is-modal-open .physical-card-rotor');
    expect(styles).toContain('transition:none');
    expect(styles).toContain('.physical-card.media-modal.is-modal-open.is-flipped .physical-card-rotor{transform:rotateY(180deg)}');
    expect(tiltStyles).toContain('.media-card:not(.review-hover)>.physical-card-rotor>.physical-card-front>a>.poster');
    expect(motionFixes).toContain('.related-work-card.card.media-card>.poster');
  });
});
