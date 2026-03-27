/**
 * Role store backed by Azure Table Storage.
 * Falls back gracefully when storage isn't configured (local dev).
 *
 * Table: userroles
 *   PartitionKey: "roles"
 *   RowKey:       sanitized email (@ and . replaced with _)
 *   email:        original email
 *   role:         "admin" | "technician" | "receiver"
 */

import { TableClient, TableEntity, odata } from "@azure/data-tables";

export type AppRole = "admin" | "technician" | "receiver";

const TABLE = "userroles";

function getClient(): TableClient | null {
  const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!conn) return null;
  try {
    return TableClient.fromConnectionString(conn, TABLE);
  } catch {
    return null;
  }
}

function sanitize(email: string): string {
  return email.toLowerCase().replace(/[@.]/g, "_");
}

/** Returns role for email, checking ADMIN_EMAILS bootstrap first. */
export async function getUserRole(email: string): Promise<AppRole | null> {
  const norm = email.toLowerCase().trim();

  // Bootstrap: ADMIN_EMAILS always grants admin regardless of table
  const adminEmails = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (adminEmails.includes(norm)) return "admin";

  const client = getClient();
  if (!client) return null;

  try {
    const entity = await client.getEntity<{ role: string }>("roles", sanitize(norm));
    return entity.role as AppRole;
  } catch {
    return null;
  }
}

export interface RoleEntry {
  email: string;
  role: AppRole;
}

export async function listRoles(): Promise<RoleEntry[]> {
  const client = getClient();
  if (!client) return [];

  const results: RoleEntry[] = [];
  const iter = client.listEntities<TableEntity & { email: string; role: string }>({
    queryOptions: { filter: odata`PartitionKey eq 'roles'` },
  });

  for await (const entity of iter) {
    results.push({ email: entity.email, role: entity.role as AppRole });
  }

  // Also surface ADMIN_EMAILS bootstrap entries (not in table)
  const adminEmails = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  for (const email of adminEmails) {
    if (!results.find((r) => r.email === email)) {
      results.push({ email, role: "admin" });
    }
  }

  return results;
}

export async function setRole(email: string, role: AppRole): Promise<void> {
  const client = getClient();
  if (!client) throw new Error("AZURE_STORAGE_CONNECTION_STRING is not configured");

  const norm = email.toLowerCase().trim();
  await client.upsertEntity(
    { partitionKey: "roles", rowKey: sanitize(norm), email: norm, role },
    "Replace"
  );
}

export async function deleteRole(email: string): Promise<void> {
  const client = getClient();
  if (!client) throw new Error("AZURE_STORAGE_CONNECTION_STRING is not configured");

  await client.deleteEntity("roles", sanitize(email.toLowerCase().trim()));
}
