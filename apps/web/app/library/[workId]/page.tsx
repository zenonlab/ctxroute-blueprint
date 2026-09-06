import { notFound } from 'next/navigation';

export const dynamicParams = false;
export function generateStaticParams(): { workId: string }[] { return [{ workId: '_' }]; }
export default function PublicWorkPage() { notFound(); }
