/* Shared SVG icon sprite for login + dashboard. Usage: <svg class="ic"><use href="#i-name"/></svg> */
(function () {
  const S = 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
  const icons = {
    chev: `<path d="M9 5.5 15.5 12 9 18.5"/>`,
    'chev-down': `<path d="m6 9 6 6 6-6"/>`,
    left: `<path d="M19 12H5M11 6l-6 6 6 6"/>`,
    right: `<path d="M5 12h14M13 6l6 6-6 6"/>`,
    up: `<path d="M12 19V5M6 11l6-6 6 6"/>`,
    x: `<path d="M6 6l12 12M18 6 6 18"/>`,
    check: `<path d="M5 12.5l4.5 4.5L19 7.5"/>`,
    grid: `<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>`,
    pill: `<rect x="2.8" y="8" width="18.4" height="8" rx="4" transform="rotate(-45 12 12)"/><path d="m8.8 8.8 6.4 6.4"/>`,
    file: `<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>`,
    cal: `<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>`,
    list: `<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>`,
    users: `<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.4A6.5 6.5 0 0 1 21.5 20"/>`,
    user: `<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>`,
    sliders: `<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>`,
    'st-good': `<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.7 2.7L16 10"/>`,
    'st-warn': `<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4.5M12 17.2h.01"/>`,
    'st-crit': `<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 8v5M12 16.2h.01"/>`,
    'st-neutral': `<circle cx="12" cy="12" r="8.5" stroke-dasharray="3.2 3"/>`,
    trend: `<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>`,
    truck: `<path d="M2.5 6.5h11v10h-11zM13.5 9.5h4l3.5 3.5v3.5h-7.5"/><circle cx="6.5" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>`,
    card: `<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M2.5 10h19M6 15h4"/>`,
    voice: `<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>`,
    escalate: `<path d="M7 17 17 7M8 7h9v9"/>`,
    tube: `<path d="M9 3h6M10 3v13.5a2 2 0 0 0 4 0V3"/><path d="M10 11h4"/>`,
    download: `<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>`,
    plane: `<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>`,
    chat: `<path d="M20.5 11.5a8.5 8.5 0 0 1-12.4 7.6L3.5 20.5l1.4-4.4A8.5 8.5 0 1 1 20.5 11.5z"/>`,
    mail: `<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 7 8.5 6 8.5-6"/>`,
    shield: `<path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6z"/><path d="m8.8 12 2.2 2.2 4.4-4.4"/>`,
    lock: `<rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>`,
    phone: `<path d="M5 3.5h3.5l2 5-2.6 1.6a11 11 0 0 0 5 5l1.6-2.6 5 2v3.5a2 2 0 0 1-2 2A16.5 16.5 0 0 1 3 5.5a2 2 0 0 1 2-2"/>`,
    undo: `<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>`,
    clock: `<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>`,
    logout: `<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10"/>`,
    bell: `<path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9M10 20a2 2 0 0 0 4 0"/>`,
    info: `<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>`,
    flag: `<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>`,
    image: `<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>`,
    pad: `<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2.8h6V4M8.5 10h7M8.5 14h5"/>`,
    code: `<path d="m8 8-4 4 4 4M16 8l4 4-4 4"/>`,
    home: `<path d="M3.5 11 12 4l8.5 7"/><path d="M5.5 9.5V20h13V9.5"/>`,
    activity: `<path d="M3 12h4l3-7 4 14 3-7h4"/>`,
    mic: `<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>`,
    rupee: `<path d="M6 4h12M6 9h12M6 14h3.5a5 5 0 0 0 0-10M9.5 14l6.5 7"/>`,
    store: `<path d="M4 9.5V20h16V9.5M3 9.5 5 4h14l2 5.5zM10 20v-5h4v5"/>`,
    keyboard: `<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>`,
    play: `<path d="M8 5.2v13.6a.8.8 0 0 0 1.2.7l10.6-6.8a.8.8 0 0 0 0-1.4L9.2 4.5A.8.8 0 0 0 8 5.2z" fill="currentColor" stroke="none"/>`,
    reset: `<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>`,
    zap: `<path d="M13 2.5 4 14h7l-1 7.5L19 10h-7z"/>`
  };
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute" aria-hidden="true"><defs>' +
    Object.entries(icons).map(([k, v]) => `<symbol id="i-${k}" viewBox="0 0 24 24" ${S}>${v}</symbol>`).join('') +
    '</defs></svg>';
  document.body.insertAdjacentHTML('afterbegin', svg);
  window.ic = (name, cls = 'ic') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
})();
