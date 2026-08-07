import { createHash } from 'node:crypto';
import type { Task } from 'graphile-worker';
import { compressCover } from '../cover-store.js';

const task:Task=async(payload,helpers)=>{const mediaId=String((payload as any)?.mediaId??'');if(!mediaId)return;const cover=await helpers.query("SELECT COALESCE(a.data,c.data) AS data FROM media_cover c LEFT JOIN catalog_image_asset a ON a.sha256=c.asset_sha256 WHERE c.media_id=$1 AND c.status='ACTIVE'",[mediaId]);if(!cover.rows[0]?.data)return;const result=await compressCover(Buffer.from(cover.rows[0].data,'base64'));const sha256=createHash('sha256').update(result.data).digest('hex');await helpers.query("INSERT INTO catalog_image_asset(sha256,mime_type,data,width,height,byte_size) VALUES($1,'image/webp',$2,$3,$4,$5) ON CONFLICT(sha256) DO NOTHING",[sha256,result.data.toString('base64'),result.info.width,result.info.height,result.data.length]);await helpers.query("UPDATE media_cover SET data=NULL,asset_sha256=$1,content_sha256=$1,mime_type='image/webp',width=$2,height=$3,byte_size=$4,fetched_at=now(),error=NULL WHERE media_id=$5",[sha256,result.info.width,result.info.height,result.data.length,mediaId]);};
export default task;
