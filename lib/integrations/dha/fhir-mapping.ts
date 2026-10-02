export function mapPatientToFHIR(patient: any): any {
  return {
    resourceType: 'Patient',
    id: patient.id,
    identifier: [
      {
        use: 'official',
        system: 'http://dha.go.ke/identifiers/national-id',
        value: patient.national_id || '',
      },
    ],
    name: [
      {
        use: 'official',
        family: patient.last_name || '',
        given: [patient.first_name || ''],
      },
    ],
    gender: patient.gender === 'M' ? 'male' : patient.gender === 'F' ? 'female' : 'other',
    birthDate: patient.date_of_birth,
    telecom: [
      {
        system: 'phone',
        value: patient.phone_number,
        use: 'mobile',
      },
    ],
  };
}

export function mapClaimToFHIR(claim: any, claimLines: any[], patient: any, encounter: any, provider: any): any {
  return {
    resourceType: 'Claim',
    id: claim.claim_number,
    status: 'active',
    type: {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/claim-type',
          code: 'institutional',
        },
      ],
    },
    use: 'claim',
    patient: {
      reference: `Patient/${patient.id}`,
    },
    created: claim.created_at,
    provider: {
      reference: `Organization/${provider.id}`, // e.g. MFL code
    },
    priority: {
      coding: [
        {
          code: 'normal',
        },
      ],
    },
    diagnosis: [
      // map from encounter diagnoses...
    ],
    item: claimLines.map((line, index) => ({
      sequence: index + 1,
      productOrService: {
        coding: [
          {
            system: 'http://dha.go.ke/terminology/services',
            code: line.service_id, 
          },
        ],
      },
      net: {
        value: line.amount_minor_units / 100,
        currency: 'KES',
      },
    })),
    total: {
      value: claim.total_minor_units / 100,
      currency: 'KES',
    },
  };
}
