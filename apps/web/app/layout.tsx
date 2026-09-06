import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'TobiRink — votre Workbench local',
  description: 'Bibliothèque, progression et agenda projetés localement par l’extension TobiRink.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="fr"><body>{children}</body></html>;
}
