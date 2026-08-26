const colors = {
  background: '#F9F9F8',
  surface: '#FFFFFF',
  ink: '#0F172A',
  accent: '#4A5568',
  muted: '#64748B',
  border: '#E2E8F0'
};

function hexToRgb(hex) {
  const num = parseInt(hex.slice(1), 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function luminance([r, g, b]) {
  const a = [r, g, b].map(v => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
}

function contrast(hex1, hex2) {
  const lum1 = luminance(hexToRgb(hex1));
  const lum2 = luminance(hexToRgb(hex2));
  const brightest = Math.max(lum1, lum2);
  const darkest = Math.min(lum1, lum2);
  return (brightest + 0.05) / (darkest + 0.05);
}

const pairs = [
  ['Ink (#0F172A)', colors.ink, 'Background (#F9F9F8)', colors.background],
  ['Ink (#0F172A)', colors.ink, 'Surface (#FFFFFF)', colors.surface],
  ['Muted (#64748B)', colors.muted, 'Background (#F9F9F8)', colors.background],
  ['Muted (#64748B)', colors.muted, 'Surface (#FFFFFF)', colors.surface],
  ['Accent (#4A5568)', colors.accent, 'Background (#F9F9F8)', colors.background],
  ['Accent (#4A5568)', colors.accent, 'Surface (#FFFFFF)', colors.surface],
  ['White text (#FFFFFF)', colors.surface, 'Accent (#4A5568) button bg', colors.accent],
  ['White text (#FFFFFF)', colors.surface, 'Ink (#0F172A) button bg', colors.ink],
  ['Border (#E2E8F0)', colors.border, 'Background (#F9F9F8)', colors.background],
  ['Border (#E2E8F0)', colors.border, 'Surface (#FFFFFF)', colors.surface],
  ['Surface (#FFFFFF)', colors.surface, 'Background (#F9F9F8)', colors.background],
];

console.log("=== WCAG CONTRAST RATIO ANALYSIS ===");
pairs.forEach(([name1, c1, name2, c2]) => {
  const ratio = contrast(c1, c2);
  let status = "";
  if (ratio >= 7.0) {
    status = "AAA Normal & AAA Large (Excellent)";
  } else if (ratio >= 4.5) {
    status = "AA Normal & AAA Large (Pass)";
  } else if (ratio >= 3.0) {
    status = "AA Large / UI Components only (Fail for normal text)";
  } else {
    status = "Fail for text (Decorative / Low contrast UI only)";
  }
  console.log(`${name1} vs ${name2}: ${ratio.toFixed(2)}:1 -> ${status}`);
});
