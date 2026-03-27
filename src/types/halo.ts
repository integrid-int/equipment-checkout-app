export interface HaloTicket {
  id: number;
  summary: string;
  client_name: string;
  site_name: string;
  agent_name: string;
  status_name: string;
  dateoccurred: string;
}

export interface HaloItem {
  id: number;
  name: string;
  description?: string;
  /** Current quantity in stock */
  count: number;
  /** True = each unit has its own serial number */
  serialized: boolean;
  serialnumber?: string;
  /** Barcode for non-serialized items */
  barcode?: string;
  supplier_name?: string;
  unitprice?: number;
}

/** One line in a technician's pull list */
export interface PullEntry {
  item: HaloItem;
  quantity: number;
  /** Populated for serialized items */
  serialNumber?: string;
}

export interface SwaUser {
  clientPrincipal: {
    userId: string;
    userRoles: string[];
    claims: Array<{ typ: string; val: string }>;
    identityProvider: string;
    userDetails: string;
  } | null;
}
