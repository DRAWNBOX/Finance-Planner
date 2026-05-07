export const FLAG_PALETTE = [
  '#e74c3c',
  '#3498db',
  '#2ecc71',
  '#f39c12',
  '#9b59b6',
  '#1abc9c',
  '#e67e22',
  '#34495e'
] as const;

export const pickFlagColor = (existingColors: (string | undefined)[]): string => {
  const used = new Set(existingColors.filter((c): c is string => Boolean(c)));
  const available = FLAG_PALETTE.find((color) => !used.has(color));
  return available ?? FLAG_PALETTE[0];
};
