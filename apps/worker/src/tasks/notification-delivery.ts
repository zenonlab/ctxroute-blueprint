import { deliverNtfy, NtfyError, type NotificationItem } from '@favlib/notifications';

type Result={rows:any[];rowCount?:number|null};type DeliveryHelpers={query:(sql:string,values?:unknown[])=>Promise<Result>};
type Delivery=(topic:string,items:NotificationItem[],sequenceId:string)=>Promise<unknown>;

const createBatchSql=`WITH preference AS (
  SELECT p.user_id,p.ntfy_topic FROM notification_preference p WHERE p.ntfy_topic IS NOT NULL
  AND NOT EXISTS(SELECT 1 FROM notification_delivery_batch recent WHERE recent.user_id=p.user_id AND recent.delivered_at>now()-interval '5 minutes')
  AND NOT EXISTS(SELECT 1 FROM notification_delivery_batch active WHERE active.user_id=p.user_id AND active.status IN ('PENDING','SENDING'))
), candidates AS (
  SELECT preference.user_id,preference.ntfy_topic,ARRAY(SELECT n.id FROM personal_notification n WHERE n.user_id=preference.user_id AND n.delivered_at IS NULL AND n.delivery_batch_id IS NULL ORDER BY n.created_at,n.id LIMIT 100) ids FROM preference
), inserted AS (
  INSERT INTO notification_delivery_batch(user_id,topic,event_ids,sequence_id)
  SELECT user_id,ntfy_topic,ids,md5(user_id::text||':'||array_to_string(ids,',')) FROM candidates WHERE cardinality(ids)>0 ON CONFLICT(sequence_id) DO NOTHING RETURNING id,event_ids
)
UPDATE personal_notification n SET delivery_batch_id=i.id FROM inserted i WHERE n.id=ANY(i.event_ids)`;

export default async function notificationDelivery(_payload:unknown,helpers:DeliveryHelpers,deliver:Delivery=async(topic,items,id)=>deliverNtfy(topic,items,undefined,id)){
  await helpers.query(createBatchSql);
  const claimed=await helpers.query(`UPDATE notification_delivery_batch b SET status='SENDING',leased_until=now()+interval '30 seconds'
    WHERE b.id=(SELECT candidate.id FROM notification_delivery_batch candidate
      WHERE (candidate.status='PENDING' OR candidate.status='SENDING' AND candidate.leased_until<now()) AND candidate.next_attempt_at<=now()
      AND NOT EXISTS(SELECT 1 FROM notification_delivery_batch recent WHERE recent.user_id=candidate.user_id AND recent.status='DELIVERED' AND recent.delivered_at>now()-interval '5 minutes')
      ORDER BY candidate.created_at FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING id,user_id AS "userId",topic,event_ids AS "eventIds",sequence_id AS "sequenceId",attempt_count AS "attemptCount"`);
  const batch=claimed.rows[0];if(!batch)return 0;
  const result=await helpers.query('SELECT id,user_id AS "userId",kind,release_key AS "releaseKey",payload,created_at AS "createdAt" FROM personal_notification WHERE id=ANY($1::uuid[]) ORDER BY created_at,id',[batch.eventIds]);
  try{
    await deliver(batch.topic,result.rows as NotificationItem[],batch.sequenceId);
    await helpers.query(`WITH done AS (UPDATE notification_delivery_batch SET status='DELIVERED',delivered_at=now(),leased_until=NULL,last_error=NULL WHERE id=$1 AND status='SENDING' RETURNING event_ids) UPDATE personal_notification n SET delivered_at=now() FROM done WHERE n.id=ANY(done.event_ids)`,[batch.id]);return result.rows.length;
  }catch(error){
    const attempt=Number(batch.attemptCount)+1,retryAt=error instanceof NtfyError?error.retryAt:undefined;const delay=Math.min(3600,Math.pow(2,attempt)*5+Math.random()*5);
    await helpers.query(`UPDATE notification_delivery_batch SET status=CASE WHEN $2>=10 THEN 'FAILED' ELSE 'PENDING' END,attempt_count=$2,next_attempt_at=COALESCE(to_timestamp($3::double precision/1000),now()+make_interval(secs=>$4)),leased_until=NULL,last_error=$5 WHERE id=$1`,[batch.id,attempt,retryAt??null,delay,error instanceof Error?error.message.slice(0,500):'UNKNOWN']);return 0;
  }
}
