import { Suspense } from 'react';
import { WorkDetail } from './WorkDetail';

export const dynamicParams = false;
export function generateStaticParams(): { workId: string }[] { return [{ workId: '_' }]; }
export default function LocalWorkPage() { return <Suspense><WorkDetail /></Suspense>; }
