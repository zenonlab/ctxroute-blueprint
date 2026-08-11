import React from 'react';
import type { Metadata } from 'next';
import 'flag-icons/css/flag-icons.min.css';
import './globals.css';
import './media-overrides.css';
import './carousel.css';
import './pagination.css';
import './shelves.css';
import './planning.css';
import './notifications.css';
import './settings.css';
import './login.css';
import './card-tilt.css';
import './physical-card.css';
import './physical-card-motion-fixes.css';
import './report-card.css';
import './design-fixes.css';

export const metadata:Metadata={title:{default:'FavLib',template:'%s · FavLib'},description:'Bibliothèque locale privée de favoris manga et anime'};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="fr" suppressHydrationWarning><body>{children}</body></html>;
}
