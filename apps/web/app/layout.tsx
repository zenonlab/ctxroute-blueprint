import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'TobiRink — votre bibliothèque manga et anime',
  description: 'Retrouvez vos œuvres, votre progression et vos prochaines sorties avec l’extension TobiRink.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="fr"><body>{children}</body></html>;
}
