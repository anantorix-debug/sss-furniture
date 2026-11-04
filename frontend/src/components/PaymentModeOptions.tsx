// Payment mode choices for worker and supplier payments. When editing, a saved
// mode that isn't in the list (for example IOB) is kept as an option, so the
// box shows it and saving can't quietly change it.
const PAYMENT_MODES = ['CASH', 'GPAY', 'UPI', 'UPI-HDFC'];

export function PaymentModeOptions({ current }: { current?: string | null }) {
  const modes = current && !PAYMENT_MODES.includes(current) ? [...PAYMENT_MODES, current] : PAYMENT_MODES;
  return (
    <>
      {modes.map((m) => (
        <option key={m}>{m}</option>
      ))}
    </>
  );
}
