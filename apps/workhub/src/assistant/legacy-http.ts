import { getSession } from '@daedong/shared';
import { createAssistantHttp } from './http';
export const legacyAssistantHttp = createAssistantHttp({ getSession });
