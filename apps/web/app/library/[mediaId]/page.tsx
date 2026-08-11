import { FavLibApp } from '../../favlib-app';

export default async function MediaPage({params}:{params:Promise<{mediaId:string}>}) {
  const {mediaId}=await params;
  return <FavLibApp initialPath={`/library/${encodeURIComponent(mediaId)}`} />;
}
