import { OPERATIONAL_DEFAULTS,operationalSettingSchemas,type OperationalSettingKey } from '@favlib/config';
type Query={query:(sql:string,values?:unknown[])=>Promise<{rows?:any[]}>};
export async function operationalValue<K extends OperationalSettingKey>(helpers:Query,key:K):Promise<number>{const result=await helpers.query('SELECT value FROM operational_setting WHERE key=$1',[key]);if(!result.rows?.[0])return OPERATIONAL_DEFAULTS[key];const parsed=operationalSettingSchemas[key].safeParse(result.rows[0].value);return parsed.success?parsed.data:OPERATIONAL_DEFAULTS[key]}
