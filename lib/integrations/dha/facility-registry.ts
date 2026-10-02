import { submitDHARequest } from './index';

export async function fetchFacilityDetails(tenantId: string, mflCode: string) {
  return submitDHARequest({
    tenantId,
    endpoint: `/facility-registry/${mflCode}`,
    method: 'GET',
    payload: {},
    integrationType: 'dha_registry'
  });
}
