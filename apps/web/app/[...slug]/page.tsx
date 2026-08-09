import { FavLibApp } from '../favlib-app';
import { redirect } from 'next/navigation';

export default async function RoutePage({params}:{params:Promise<{slug:string[]}>}) {
  const {slug}=await params;
  // Legacy standalone review pages are intentionally gone. Review decisions
  // remain exclusively in NotificationResolver; do not route this redirect
  // through or modify that resolver.
  if(slug[0]==='review')redirect('/');
  return <FavLibApp />;
}
