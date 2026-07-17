import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types.gen';

type Client = SupabaseClient<Database>;

export interface FamilyLedgerEntry {
  id: string;
  entry_type: string;
  amount_cents: number;
  currency: string;
  description: string;
  effective_at: string;
  source_invoice_id: string | null;
  source_payment_id: string | null;
}
export async function listFamilyLedger(
  client: Client,
  familyId: string,
): Promise<FamilyLedgerEntry[]> {
  const { data, error } = await client
    .from('family_ledger_entries')
    .select(
      'id, entry_type, amount_cents, currency, description, effective_at, source_invoice_id, source_payment_id',
    )
    .eq('family_id', familyId)
    .order('effective_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getFamilyLedgerBalance(client: Client, familyId: string): Promise<number> {
  const { data, error } = await client.rpc('get_family_ledger_balance', { p_family_id: familyId });
  if (error) throw error;
  return data;
}
