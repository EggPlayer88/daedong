import { getSession } from '@daedong/shared';
import { createAssistantHttp } from './http';
export const legacyAssistantHttp = createAssistantHttp({ getSession });

export const legacySchoolAiHttp = createAssistantHttp({ getSession, endpoint:'/api/workhub-ai/settings' });
