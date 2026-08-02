import React from 'react';
import './globals.css';
import './media-overrides.css';
import './carousel.css';
import './pagination.css';
import './shelves.css';
import './planning.css';
import './notifications.css';
import './settings.css';

export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="fr" suppressHydrationWarning><body>{children}</body></html>;
}
