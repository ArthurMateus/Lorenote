// Lorenote icon set: 24×24 outline icons, drawn with currentColor so they follow the theme.
const P = {
  note: '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  todo: '<rect x="3.5" y="4" width="5" height="5" rx="1.2"/><path d="m4.6 6.6 1.3 1.3 2-2.4"/><rect x="3.5" y="13" width="5" height="5" rx="1.2"/><path d="M12 6.5h8.5M12 15.5h8.5"/>',
  line: '<path d="M5 19 19 5M10 5h9v9"/>',
  board: '<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>',
  column: '<rect x="3.5" y="4" width="17" height="16" rx="3"/><path d="M3.5 9h17M8 13h8M8 16.5h8"/>',
  comment: '<path d="M6 5h12a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 18 17h-5.5L8 20.5V17H6a2.5 2.5 0 0 1-2.5-2.5v-7A2.5 2.5 0 0 1 6 5Z"/><path d="M8 10h8M8 13h5"/>',
  table: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M3.5 15h17M9.5 4.5v15M15 4.5v15"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="m4.5 18 5-5 3.5 3.5 2.5-2.5 4.5 4.5"/>',
  file: '<path d="M6 3.5h8l4.5 4.5V20a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 20V5A1.5 1.5 0 0 1 6 3.5Z"/><path d="M14 3.5V8h4.5M8 13h8M8 17h6"/>',
  sketch: '<path d="m4 20 1-4L16.5 4.5a2 2 0 0 1 3 3L8 19Z"/><path d="m14.5 6.5 3 3"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H12"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H12"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5M14 11v5"/>',
  menu: '<circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5V5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>', close: '<path d="m6 6 12 12M18 6 6 18"/>',
  fit: '<path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"/><rect x="8.5" y="8.5" width="7" height="7" rx="1.5"/>',
  map: '<path d="m3.5 6.5 5.5-2 6 2.5 5.5-2v13l-5.5 2-6-2.5-5.5 2Z"/><path d="M9 4.5v13M15 7v13"/>',
  present: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M12 16v4M8 20h8"/><path d="m10.5 8.2 4 2.3-4 2.3Z"/>',
  folder: '<path d="M4 6.5A1.5 1.5 0 0 1 5.5 5H9l2 2h7.5A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5Z"/>',
  tree: '<rect x="3.5" y="3.5" width="7" height="5" rx="1.5"/><rect x="13.5" y="10" width="7" height="5" rx="1.5"/><rect x="13.5" y="17" width="7" height="3.5" rx="1.5"/><path d="M7 8.5v8.5a1 1 0 0 0 1 1h5.5M7 12.5h6.5"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  unlock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 7.5-2"/>',
  front: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M4 15V6.5A2.5 2.5 0 0 1 6.5 4H15"/>',
  back: '<rect x="4" y="4" width="12" height="12" rx="2.5"/><path d="M20 9v8.5a2.5 2.5 0 0 1-2.5 2.5H9"/>',
  'align-left': '<path d="M4 3.5v17"/><rect x="7" y="6" width="12" height="4.5" rx="1.2"/><rect x="7" y="13.5" width="7" height="4.5" rx="1.2"/>',
  'align-center': '<path d="M12 3.5v17"/><rect x="5" y="6" width="14" height="4.5" rx="1.2"/><rect x="8" y="13.5" width="8" height="4.5" rx="1.2"/>',
  'align-right': '<path d="M20 3.5v17"/><rect x="5" y="6" width="12" height="4.5" rx="1.2"/><rect x="10" y="13.5" width="7" height="4.5" rx="1.2"/>',
  'align-top': '<path d="M3.5 4h17"/><rect x="6" y="7" width="4.5" height="12" rx="1.2"/><rect x="13.5" y="7" width="4.5" height="7" rx="1.2"/>',
  'align-middle': '<path d="M3.5 12h17"/><rect x="6" y="5" width="4.5" height="14" rx="1.2"/><rect x="13.5" y="8" width="4.5" height="8" rx="1.2"/>',
  'align-bottom': '<path d="M3.5 20h17"/><rect x="6" y="5" width="4.5" height="12" rx="1.2"/><rect x="13.5" y="10" width="4.5" height="7" rx="1.2"/>',
  'dist-h': '<path d="M4 4v16M20 4v16"/><rect x="9.5" y="7" width="5" height="10" rx="1.2"/>',
  'dist-v': '<path d="M4 4h16M4 20h16"/><rect x="7" y="9.5" width="10" height="5" rx="1.2"/>',
  duplicate: '<rect x="8.5" y="8.5" width="11" height="11" rx="2.5"/><path d="M15.5 8.5V6A2.5 2.5 0 0 0 13 3.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5"/>',
  template: '<rect x="3.5" y="3.5" width="17" height="6" rx="2"/><rect x="3.5" y="12.5" width="7" height="8" rx="2"/><rect x="13.5" y="12.5" width="7" height="8" rx="2"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>', home: '<path d="m4 11 8-6.5 8 6.5M6 9.5V19a1 1 0 0 0 1 1h3.5v-5h3v5H17a1 1 0 0 0 1-1V9.5"/>',
  arrowLeft: '<path d="M19 12H5M11 6l-6 6 6 6"/>', arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
};

export const icon = (name, size = 20) => `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;

/** replace every <i data-icon="name" [data-size]> under root with its SVG */
export function hydrateIcons(root = document) {
  for (const el of root.querySelectorAll('[data-icon]')) { el.innerHTML = icon(el.dataset.icon, +el.dataset.size || 20); el.removeAttribute('data-icon'); }
}
export const iconNames = Object.keys(P);
