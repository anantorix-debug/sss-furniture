// Drawn instead of the 🚚 emoji, whose facing direction differs between
// operating systems/browsers - this one always faces right (cab on the
// right), the direction the dispatch animations move it.
export function TruckIcon({ className = 'h-10 w-10' }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 32" className={className} fill="none" aria-hidden="true">
      <rect x="2" y="6" width="27" height="17" rx="2" fill="#80011f" />
      <path d="M31 11h8l6 7v5H31V11z" fill="#c2410c" />
      <path d="M34 13.5h4.2l3.4 4H34v-4z" fill="#fde7c8" />
      <rect x="2" y="23" width="43" height="2.5" fill="#4b5563" />
      <circle cx="13" cy="26" r="4" fill="#1f2933" />
      <circle cx="13" cy="26" r="1.6" fill="#d1d5db" />
      <circle cx="37" cy="26" r="4" fill="#1f2933" />
      <circle cx="37" cy="26" r="1.6" fill="#d1d5db" />
    </svg>
  );
}
