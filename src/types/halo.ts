export interface HaloField {
  name: string;
  value: string;
}

export interface HaloAsset {
  id: number;
  inventory_number: string;       // barcode / serial number
  assettype_name: string;         // e.g. "Laptop", "Camera"
  client_name: string;
  site_name: string;
  status_name: string;            // e.g. "Available", "In Use"
  fields: HaloField[];
}

export interface SwaUser {
  clientPrincipal: {
    userId: string;
    userRoles: string[];
    claims: Array<{ typ: string; val: string }>;
    identityProvider: string;
    userDetails: string; // email / UPN
  } | null;
}

export interface CheckoutPayload {
  assetId: number;
  checkedOutTo: string;
  checkedOutByEmail: string;
  notes?: string;
}

export interface CheckinPayload {
  assetId: number;
  returnedByEmail: string;
  notes?: string;
}
