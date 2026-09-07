import { Icon, Surface } from '@tobirink/ui';
import { SiteShell } from '../components/SiteShell';
import extensionPackage from '../../../extension/package.json';

export function publicDownloads(version: string) {
  return [
    { browser: 'Chrome', href: `/downloads/tobirink-chrome-mv3-${version}.zip` },
    { browser: 'Firefox', href: `/downloads/tobirink-firefox-mv3-${version}.zip` },
  ];
}

export default function DownloadPage() {
  const downloads = publicDownloads(extensionPackage.version);
  return <SiteShell><main className="member-page"><header className="member-hero compact"><p className="eyebrow">Extension TobiRink {extensionPackage.version}</p><h1>Installer TobiRink.</h1><p>À la première installation, l’extension crée une base privée neuve, analyse automatiquement les favoris HTTP(S) de votre navigateur et prépare votre bibliothèque. Aucune autre base n’est lue ou migrée.</p></header><section className="member-section" aria-labelledby="downloads-title"><div className="section-heading"><div><p className="eyebrow">Paquets vérifiés</p><h2 id="downloads-title">Choisir votre navigateur</h2></div></div><div className="info-grid">{downloads.map(({ browser, href }) => <Surface as="article" className="info-panel" header={<h2>{browser}</h2>} key={browser} variant="outlined"><p>Archive MV3 TobiRink {extensionPackage.version}.</p><a className="download-link" download href={href}><Icon name="download" size="sm" />Télécharger pour {browser}</a></Surface>)}</div></section></main></SiteShell>;
}
