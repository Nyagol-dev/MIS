import { submitDHARequest } from './index';

export async function verifyHealthWorker(tenantId: string, licenceNumber: string) {
  return submitDHARequest({
    tenantId,
    endpoint: `/health-worker-registry/verify`,
    method: 'GET',
    payload: { licenceNumber },
    integrationType: 'dha_registry'
  });
}
