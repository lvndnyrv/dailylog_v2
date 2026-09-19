import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '../types.gen';

type Client = SupabaseClient<Database>;

export type BillingSummary =
  Database['public']['Functions']['get_billing_summary']['Returns'][number];

export interface InvoiceLineInput {
  description: string;
  quantity: number;
  unit_amount_cents: number;
}

export interface InvoiceRow {
  id: string;
  number: string | null;
  status: string;
  issued_on: string | null;
  due_on: string | null;
  total_cents: number;
  family: { id: string; display_name: string } | null;
  child: { id: string; first_name: string; last_name: string } | null;
  billed_to_profile: { id: string; full_name: string; email: string } | null;
  lines: { id: string; description: string; quantity: number; amount_cents: number }[];
  payments: { id: string; amount_cents: number; method: string | null; paid_at: string | null }[];
  reminders: { id: string; sent_at: string; tone: string; status: string }[];
}

const INVOICE_SELECT = `id, number, status, issued_on, due_on, total_cents,
  family:families(id, display_name),
  child:children(id, first_name, last_name),
  billed_to_profile:profiles!invoices_billed_to_fkey(id, full_name, email),
  lines:invoice_lines(id, description, quantity, amount_cents),
  payments:payments!payments_invoice_id_fkey(id, amount_cents, method, paid_at),
  reminders:invoice_reminder_events(id, sent_at, tone, status)`;

export async function listInvoices(client: Client): Promise<InvoiceRow[]> {
  const { data, error } = await client
    .from('invoices')
    .select(INVOICE_SELECT)
    .order('issued_on', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as InvoiceRow[];
}

export async function getBillingSummary(client: Client): Promise<BillingSummary | null> {
  const { data, error } = await client.rpc('get_billing_summary');
  if (error) throw error;
  return data?.[0] ?? null;
}

export async function createInvoice(
  client: Client,
  childId: string | null,
  billedTo: string | null,
  dueOn: string,
  lines: InvoiceLineInput[],
): Promise<string> {
  const { data, error } = await client.rpc('create_invoice', {
    // Supabase's generated function Args do not preserve nullable SQL inputs.
    p_child_id: childId as unknown as string,
    p_billed_to: billedTo as unknown as string,
    p_due_on: dueOn,
    p_lines: lines as unknown as Json,
  });
  if (error) throw error;
  return data;
}

export async function recordInvoicePayment(
  client: Client,
  invoiceId: string,
  amountCents: number,
  method: string,
): Promise<string> {
  const { data, error } = await client.rpc('record_invoice_payment', {
    p_invoice_id: invoiceId,
    p_amount_cents: amountCents,
    p_method: method,
  });
  if (error) throw error;
  return data;
}

export async function voidInvoice(client: Client, invoiceId: string): Promise<void> {
  const { error } = await client
    .from('invoices')
    .update({ status: 'void' })
    .eq('id', invoiceId);
  if (error) throw error;
}

export interface BillingPlan {
  id: string;
  name: string;
  amount_cents: number;
  cadence: string;
  active: boolean;
}

export interface ChildTuitionRateRow {
  id: string;
  child_id: string;
  classroom_id: string | null;
  amount_cents: number;
  currency: string;
  effective_from: string;
  effective_to: string | null;
  status: 'scheduled' | 'effective' | 'cancelled';
  source_transition_plan_id: string | null;
  child: { id: string; first_name: string; last_name: string } | null;
  classroom: { id: string; name: string } | null;
}

export async function listBillingPlans(client: Client): Promise<BillingPlan[]> {
  const { data, error } = await client
    .from('billing_plans')
    .select('id, name, amount_cents, cadence, active')
    .eq('active', true)
    .order('name');
  if (error) throw error;
  return (data ?? []) as BillingPlan[];
}

export async function listChildTuitionRates(client: Client): Promise<ChildTuitionRateRow[]> {
  const { data, error } = await client
    .from('child_tuition_rates')
    .select(
      `id, child_id, classroom_id, amount_cents, currency, effective_from,
       effective_to, status, source_transition_plan_id,
       child:children(id, first_name, last_name), classroom:classrooms(id, name)`,
    )
    .in('status', ['scheduled', 'effective'])
    .order('effective_from');
  if (error) throw error;
  return (data ?? []) as unknown as ChildTuitionRateRow[];
}

export async function createBillingPlan(
  client: Client,
  values: { daycare_id: string; name: string; amount_cents: number; cadence: string },
): Promise<void> {
  const { error } = await client.from('billing_plans').insert(values);
  if (error) throw error;
}
