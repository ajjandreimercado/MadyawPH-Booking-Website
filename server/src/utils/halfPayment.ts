/** Half of a peso amount, rounded to whole pesos for hotel cash ops. */
export function computeHalfPayment(totalAmount: number): { halfPayment: number; balanceDue: number } {
  const total = Math.max(0, Math.round(Number(totalAmount) || 0));
  const halfPayment = Math.floor(total / 2);
  const balanceDue = Math.max(0, total - halfPayment);
  return { halfPayment, balanceDue };
}

export function formatMoneyAmount(value: number): string {
  return Number(value).toFixed(2);
}
