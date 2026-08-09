import {Pool} from 'pg';
import {FAVORITE_PROGRESS_PARSER_VERSION,progressionFromFavorite,sourceIdentityFromUrl} from '@favlib/metadata';
import {runtimeEnvironment} from '@favlib/config';

const pool=new Pool({connectionString:runtimeEnvironment().databaseUrl});
const rows=await pool.query(`SELECT i.user_id,i.installation_id,i.bookmark_id,i.payload->>'title' AS title,i.payload->>'url' AS url,l.media_id
  FROM bookmark_import_item i JOIN bookmark_media_link l ON l.user_id=i.user_id AND l.installation_id=i.installation_id AND l.bookmark_id=i.bookmark_id
  WHERE i.event<>'removed' AND l.status IN ('matched','accepted') AND l.media_id IS NOT NULL`);
let evidence=0,noEvidence=0,repaired=0;
for(const favorite of rows.rows){
  const source=sourceIdentityFromUrl(favorite.url),candidate=progressionFromFavorite({title:favorite.title??'',url:favorite.url,source});
  if(!candidate){noEvidence++;await pool.query("DELETE FROM favorite_progress_candidate WHERE user_id=$1 AND installation_id=$2 AND bookmark_id=$3",[favorite.user_id,favorite.installation_id,favorite.bookmark_id]);await pool.query("UPDATE bookmark_import_item SET progress_parser_version=$1,progress_parser_fingerprint=fingerprint,progress_parse_status='no_evidence' WHERE user_id=$2 AND installation_id=$3 AND bookmark_id=$4",[FAVORITE_PROGRESS_PARSER_VERSION,favorite.user_id,favorite.installation_id,favorite.bookmark_id]);continue}
  evidence++;
  await pool.query(`INSERT INTO favorite_progress_candidate(user_id,installation_id,bookmark_id,position_kind,position_number,position_raw,raw_title,raw_url,parsed_slug,path_segments,evidence,season,local_position_number,global_position_number) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13,$14)
    ON CONFLICT(user_id,installation_id,bookmark_id,position_kind) DO UPDATE SET position_number=excluded.position_number,position_raw=excluded.position_raw,raw_title=excluded.raw_title,raw_url=excluded.raw_url,parsed_slug=excluded.parsed_slug,path_segments=excluded.path_segments,evidence=excluded.evidence,season=excluded.season,local_position_number=excluded.local_position_number,global_position_number=excluded.global_position_number,last_observed_at=now(),applied_at=CASE WHEN excluded.position_number>favorite_progress_candidate.position_number THEN NULL ELSE favorite_progress_candidate.applied_at END`,[favorite.user_id,favorite.installation_id,favorite.bookmark_id,candidate.kind,candidate.number,candidate.raw,favorite.title??'',favorite.url,source?.slug??null,JSON.stringify(candidate.provenance.pathSegments),JSON.stringify(candidate.provenance),candidate.season??null,candidate.localNumber??null,candidate.globalNumber??null]);
  const result=await pool.query("UPDATE bookmark_media_link SET status=status WHERE user_id=$1 AND installation_id=$2 AND bookmark_id=$3 AND media_id=$4 AND status IN ('matched','accepted')",[favorite.user_id,favorite.installation_id,favorite.bookmark_id,favorite.media_id]);repaired+=result.rowCount??0;
  await pool.query("UPDATE bookmark_import_item SET progress_parser_version=$1,progress_parser_fingerprint=fingerprint,progress_parse_status='evidence' WHERE user_id=$2 AND installation_id=$3 AND bookmark_id=$4",[FAVORITE_PROGRESS_PARSER_VERSION,favorite.user_id,favorite.installation_id,favorite.bookmark_id]);
}
await pool.end();console.log(JSON.stringify({examined:rows.rowCount??0,evidence,noEvidence,materializationTriggered:repaired,parserVersion:FAVORITE_PROGRESS_PARSER_VERSION}));
