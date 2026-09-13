// Timber-industry board-foot formula: Thickness(in) x Width(in) x
// Length(ft) / 12 per piece, x pieces - client-side preview only (the
// server recomputes and enforces this same formula authoritatively via
// computeBoardFeet). Length is in FEET here, matching how timber is
// actually quoted/measured, not inches. Shared by every form that lets
// someone enter/preview a board-feet quantity (Purchase, Issue Material)
// so the math and rounding behavior never drifts between them.
export function boardFeetPreview(thicknessIn: string, widthIn: string, lengthFt: string, pieces: string) {
  const t = parseFloat(thicknessIn);
  const w = parseFloat(widthIn);
  const l = parseFloat(lengthFt);
  const p = parseFloat(pieces);
  if (!t || !w || !l || !p) return null;
  // Round only the final total, matching the backend's computeBoardFeet
  // exactly (which rounds once, from the unrounded per-piece figure) -
  // rounding perPiece first and then multiplying by pieces can drift from
  // what the server actually records for multi-piece lines.
  const perPieceRaw = (t * w * l) / 12;
  const perPiece = Math.round(perPieceRaw * 100) / 100;
  const total = Math.round(perPieceRaw * p * 100) / 100;
  // 1 cubic foot = 1728 cubic inches = 1728/144 = 12 board feet, so CFT is
  // just BF/12 - shown alongside BF since suppliers often quote in either.
  const totalCft = Math.round((perPieceRaw * p * 100) / 12) / 100;
  return { perPiece, total, totalCft };
}
