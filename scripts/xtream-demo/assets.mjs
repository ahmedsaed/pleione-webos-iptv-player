// Generated artwork for the demo catalog: letter logos, posters, covers and
// episode stills as plain SVG, so the server needs no image files.

export function escapeXml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function initials(name) {
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length > 1 && /^\d+$/.test(words[1])) return words[1].slice(0, 4);
  return words.slice(0, 2).map(word => word[0]).join('').toUpperCase();
}

const svg = (width, height, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`;

export function logoSvg(name, hue, text = initials(name)) {
  return svg(256, 256,
    `<rect width="256" height="256" rx="48" fill="hsl(${hue},55%,38%)"/>`
    + `<circle cx="128" cy="128" r="92" fill="hsl(${hue},60%,52%)"/>`
    + `<text x="128" y="128" dy="0.35em" text-anchor="middle" font-family="sans-serif" font-weight="700"`
    + ` font-size="${text.length > 2 ? 64 : 88}" fill="#fff">${escapeXml(text)}</text>`);
}

function gradient(hue, id) {
  return `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">`
    + `<stop offset="0" stop-color="hsl(${hue},60%,45%)"/>`
    + `<stop offset="1" stop-color="hsl(${(hue + 40) % 360},55%,18%)"/></linearGradient></defs>`;
}

export function posterSvg(title, subtitle, hue) {
  return svg(400, 600,
    gradient(hue, 'g')
    + '<rect width="400" height="600" fill="url(#g)"/>'
    + `<circle cx="200" cy="240" r="120" fill="hsl(${(hue + 180) % 360},50%,60%)" opacity="0.35"/>`
    + `<text x="200" y="470" text-anchor="middle" font-family="sans-serif" font-weight="700" font-size="${title.length > 14 ? 32 : 44}" fill="#fff">${escapeXml(title)}</text>`
    + `<text x="200" y="520" text-anchor="middle" font-family="sans-serif" font-size="24" fill="#fff" opacity="0.8">${escapeXml(subtitle)}</text>`);
}

export function stillSvg(title, hue) {
  return svg(640, 360,
    gradient(hue, 's')
    + '<rect width="640" height="360" fill="url(#s)"/>'
    + `<text x="320" y="180" dy="0.35em" text-anchor="middle" font-family="sans-serif" font-weight="700" font-size="40" fill="#fff">${escapeXml(title)}</text>`);
}
