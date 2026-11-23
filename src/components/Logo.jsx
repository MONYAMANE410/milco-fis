import { useEffect, useState } from 'react';

// MILCO emblem. If MILCO's official logo is saved as public/logo.png it is shown instead;
// otherwise this original emblem is drawn: a mokorotlo (Basotho hat) in the colours of the Lesotho flag.
export function Emblem({ size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="MILCO emblem">
      <circle cx="32" cy="32" r="31" fill="#fff" />
      <path d="M1 32a31 31 0 0 1 62 0z" fill="#00209f" />
      <path d="M1 32h62a31 31 0 0 1-62 0z" fill="#009543" />
      <rect x="1" y="29" width="62" height="6" fill="#fff" />
      {/* mokorotlo */}
      <path d="M32 9 L45 31 Q32 36 19 31 Z" fill="#1d2126" />
      <path d="M32 9 L45 31 Q32 36 19 31 Z" fill="none" stroke="#fff" strokeWidth="1.2" />
      <path d="M24.5 22.5 Q32 25 39.5 22.5 M22 27 Q32 30.5 42 27" stroke="#fff" strokeWidth="1.1" fill="none" />
      <circle cx="32" cy="7.5" r="2.4" fill="#1d2126" stroke="#fff" strokeWidth="1" />
      <circle cx="32" cy="32" r="30.5" fill="none" stroke="#fff" strokeWidth="1.5" />
    </svg>
  );
}

export default function Logo({ size = 40, light = false, sub = true }) {
  const [official, setOfficial] = useState(false);
  useEffect(() => {
    const img = new Image();
    img.onload = () => setOfficial(true);
    img.src = '/logo.png';
  }, []);
  return (
    <div className={'logo' + (light ? ' light' : '')}>
      {official
        ? <img src="/logo.png" alt="MILCO" height={size} />
        : <Emblem size={size} />}
      <div>
        <div className="logo-name">MILCO</div>
        {sub && <div className="logo-sub">Made-in-Lesotho Retail Cooperative</div>}
      </div>
    </div>
  );
}
