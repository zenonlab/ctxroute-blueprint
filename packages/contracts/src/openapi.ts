import { z } from 'zod';
import { adminInvitationCreateContract,adminReviewClusterChoiceContract,adminSettingsPatchContract,adminUserPatchContract,errorEnvelope,extensionConfigContract,extensionPreferencesPatchContract,extensionProposalResultContract,extensionReleaseContract,extensionUpdateProposalContract,registerRequestContract,reviewDetailContract,reviewManualContract,reviewReportContract,reviewRevalidationChoiceContract,reviewRevalidationPageContract,sourceReportContract } from '@favlib/contracts';

function jsonSchema(schema:z.ZodType):Record<string,unknown>{return z.toJSONSchema(schema) as Record<string,unknown>}
const schemas={ErrorEnvelope:errorEnvelope,RegisterRequest:registerRequestContract,AdminSettingsPatch:adminSettingsPatchContract,AdminUserPatch:adminUserPatchContract,AdminInvitationCreate:adminInvitationCreateContract,ExtensionPreferencesPatch:extensionPreferencesPatchContract,ExtensionConfig:extensionConfigContract,ExtensionUpdateProposal:extensionUpdateProposalContract,ExtensionProposalResult:extensionProposalResultContract,ExtensionRelease:extensionReleaseContract,ReviewDetail:reviewDetailContract,ReviewManual:reviewManualContract,ReviewReport:reviewReportContract,ReviewRevalidationChoice:reviewRevalidationChoiceContract,ReviewRevalidationPage:reviewRevalidationPageContract,AdminReviewClusterChoice:adminReviewClusterChoiceContract,SourceReport:sourceReportContract};
const body=(name:keyof typeof schemas)=>({required:true,content:{'application/json':{schema:{$ref:`#/components/schemas/${name}`}}}});
const uuidParameter={in:'path',name:'id',required:true,schema:{type:'string',format:'uuid'}} as const;
const ok={responses:{'200':{description:'Success'},'404':{description:'Not found'}}};

export const openApiDocument={openapi:'3.1.0',info:{title:'FavLib API',version:'collective-review-v1'},servers:[{url:'https://favlib.home.arpa'}],paths:{
  '/api/v1/auth/register':{post:{requestBody:body('RegisterRequest'),responses:{'201':{description:'Member created'},'4XX':{description:'Invitation or payload rejected'}}}},
  '/api/v1/catalog/media/{mediaId}':{get:{parameters:[{in:'path',name:'mediaId',required:true,schema:{type:'string'}},{in:'header',name:'X-Timezone',required:false,schema:{type:'string'}}],...ok}},
  '/api/v1/library/{mediaId}/source-reports':{post:{parameters:[{in:'path',name:'mediaId',required:true,schema:{type:'string'}}],requestBody:body('SourceReport'),...ok}},
  '/api/v1/preferences/catalog-timezone':{get:ok,patch:ok},
  '/api/v1/preferences/content':{get:ok,patch:ok},
  '/api/v1/admin/settings':{get:ok,patch:{requestBody:body('AdminSettingsPatch'),...ok}},
  '/api/v1/admin/users/{id}':{patch:{parameters:[uuidParameter],requestBody:body('AdminUserPatch'),...ok}},
  '/api/v1/admin/invitations':{post:{requestBody:body('AdminInvitationCreate'),responses:{'201':{description:'Invitation created'}}}},
  '/api/v1/reviews/{id}':{get:{parameters:[uuidParameter],...ok}},
  '/api/v1/reviews/{id}/resolve':{post:{parameters:[uuidParameter],...ok}},
  '/api/v1/reviews/{id}/manual':{post:{parameters:[uuidParameter],requestBody:body('ReviewManual'),...ok}},
  '/api/v1/reviews/{id}/report':{post:{parameters:[uuidParameter],requestBody:body('ReviewReport'),...ok}},
  '/api/v1/revalidations':{get:ok},
  '/api/v1/revalidations/{id}/choose':{post:{parameters:[uuidParameter],requestBody:body('ReviewRevalidationChoice'),...ok}},
  '/api/v1/revalidations/{id}/skip':{post:{parameters:[uuidParameter],...ok}},
  '/api/v1/admin/review-clusters/{id}/choose':{post:{parameters:[uuidParameter],requestBody:body('AdminReviewClusterChoice'),...ok}},
  '/api/v1/admin/review-clusters/{id}/history':{get:{parameters:[uuidParameter],...ok}},
  '/api/v1/admin/review-clusters/{id}/revert':{post:{parameters:[uuidParameter],...ok}},
  '/api/v1/extension/config':{get:ok},
  '/api/v1/extension/preferences':{patch:{requestBody:body('ExtensionPreferencesPatch'),...ok}},
  '/api/v1/extension/update-proposals':{get:ok},
  '/api/v1/extension/update-proposals/{id}/result':{post:{parameters:[uuidParameter],requestBody:body('ExtensionProposalResult'),...ok}},
  '/api/v1/public/extension-releases/{browser}':{get:ok}
},components:{schemas:Object.fromEntries(Object.entries(schemas).map(([name,schema])=>[name,jsonSchema(schema)]))}} as const;
