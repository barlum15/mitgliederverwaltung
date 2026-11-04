/* Inline-SVG-Symbole (keine externen Dateien). */
(function (global) {
  'use strict';
  const p = (d) => `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  global.ICONS = {
    people: p('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.8 3.4-6 6.5-6s5.7 2.2 6.5 6"/><circle cx="17" cy="9" r="2.6"/><path d="M16 14.2c2.9-.4 5 1.5 5.6 4.8"/>'),
    db: p('<ellipse cx="12" cy="5.5" rx="7.5" ry="3"/><path d="M4.5 5.5v13c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-13"/><path d="M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3"/>'),
    folder: p('<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2.5h7.5A2.5 2.5 0 0 1 21 10v7.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/>'),
    plus: p('<path d="M12 5v14M5 12h14"/>'),
    shield: p('<path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.9-7.5-9.5V6z"/><path d="M8.8 12.2l2.2 2.2 4.4-4.6"/>'),
    check: p('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
    archive: p('<rect x="3" y="4" width="18" height="4.5" rx="1"/><path d="M5 8.5V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5M10 12.5h4"/>'),
    candle: p('<path d="M12 3c1.6 1.8 2 3 .9 4.3-.5.6-1.3.7-1.8.1-.9-1.1-.4-2.6.9-4.4z"/><rect x="8.5" y="10" width="7" height="11" rx="1"/><path d="M12 7.6V10"/>'),
    cake: p('<path d="M4 21h16M5 21v-6.5A2.5 2.5 0 0 1 7.5 12h9a2.5 2.5 0 0 1 2.5 2.5V21"/><path d="M5 16.5c1.2 1 2.3 1 3.5 0s2.3-1 3.5 0 2.3 1 3.5 0 2.3-1 3.5 0"/><path d="M12 12V8.5M12 5.6c.8-.8.8-1.6 0-2.6-.8 1-.8 1.8 0 2.6z"/>'),
    excel: p('<path d="M14 3H6.5A2.5 2.5 0 0 0 4 5.5v13A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V9z"/><path d="M14 3v6h6M8.5 12.5l4 5M12.5 12.5l-4 5"/>'),
    save: p('<path d="M5 3h11l4 4v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 1-2z"/><path d="M8 3v5h7V3M8 21v-7h8v7"/>'),
    switch: p('<path d="M4 8h13l-3.5-3.5M20 16H7l3.5 3.5"/>'),
    search: p('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.3-4.3"/>'),
    x: p('<path d="M6 6l12 12M18 6L6 18"/>'),
    trash: p('<path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5"/>'),
    edit: p('<path d="M4 20h4.5L19.3 9.2a2.1 2.1 0 0 0-3-3L5.5 17v3z"/><path d="M14.5 8l2.9 2.9"/>'),
    undo: p('<path d="M9 7L4.5 11.5 9 16"/><path d="M4.5 11.5H15a5 5 0 0 1 0 10h-2"/>'),
    alert: p('<path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17.5v.1"/>'),
    loader: p('<path d="M12 3a9 9 0 1 0 9 9"/>')
  };
})(typeof window !== 'undefined' ? window : globalThis);
