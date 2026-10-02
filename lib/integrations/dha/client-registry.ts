import { submitDHARequest, queueIntegrationMessage } from './index';
import { mapPatientToFHIR } from './fhir-mapping';

export async function searchClientRegistry(tenantId: string, nationalId: string) {
  return submitDHARequest({
    tenantId,
    endpoint: '/client-registry/search',
    method: 'GET',
    payload: { nationalId },
    integrationType: 'dha_registry'
  });
}

export async function registerClient(tenantId: string, patient: any) {
  const fhirPayload = mapPatientToFHIR(patient);
  await queueIntegrationMessage(tenantId, 'dha_registry', { action: 'register', payload: fhirPayload });
}
