// Tab bar icons, 24px stroke set to match Icons.jsx. Keyed by NAV `icon`.
const P = ({ children }) => (
  <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
const ICONS = {
  brief: <P><path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" /><path d="M10 20v-6h4v6" /></P>,
  projects: <P><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8l2 2 3.5-3.5" /><path d="M8 15h8" /></P>,
  money: <P><circle cx="12" cy="12" r="9" /><path d="M14.5 9.2c-.5-.8-1.4-1.2-2.5-1.2-1.4 0-2.5.7-2.5 1.9 0 2.7 5 1.3 5 4 0 1.2-1.1 2-2.5 2-1.2 0-2.2-.5-2.7-1.4" /><path d="M12 6.5V8M12 16v1.5" /></P>,
  rfis: <P><path d="M21 12a8 8 0 01-11.6 7.1L4 20l1-4.6A8 8 0 1121 12z" /><path d="M9.5 10a2.5 2.5 0 114 2c-.8.6-1.5 1-1.5 2" /><path d="M12 17h.01" /></P>,
  sessions: <P><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 9l3 3-3 3" /><path d="M13 15h4" /></P>,
};

export default function NavIcon({ name }) {
  return ICONS[name] || null;
}
