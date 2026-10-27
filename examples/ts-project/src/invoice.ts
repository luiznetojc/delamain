export interface InvoiceLine {
  description: string;
  quantity: number;
  unitPriceCents: number;
}

export function calculateInvoiceTotalCents(lines: InvoiceLine[], taxBps = 1000): number {
  let subtotal = 0;
  for (const line of lines) {
    if (line.quantity < 0 || line.unitPriceCents < 0) {
      throw new Error("Line quantities and prices must be non-negative");
    }
    subtotal += line.quantity * line.unitPriceCents;
  }
  const tax = Math.round((subtotal * taxBps) / 10000);
  return subtotal + tax;
}
