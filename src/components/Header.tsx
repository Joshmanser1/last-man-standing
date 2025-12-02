// src/components/Header.tsx
import { Link } from "react-router-dom";
import { useLocation } from "react-router-dom";

export function Header() {
  const { pathname } = useLocation();

  // Keep the header visible on all pages; layout (full-bleed vs container) can be handled in App.tsx
  return (
    <header
      className="w-full sticky top-0 z-40 border-b border-white/5"
      style={{
        background:
          "linear-gradient(180deg, rgba(8,12,20,.9) 0%, rgba(8,12,20,.75) 100%)",
        backdropFilter: "saturate(120%) blur(6px)",
      }}
    >
      <div className="mx-auto max-w-7xl px-4 py-3 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-3">
          {/* Always the same shield image */}
          <img
            src="/logo-shield.png"
            alt="Fantasy Command Centre"
            width={28}
            height={28}
            className="rounded-xl block"
            loading="eager"
            decoding="async"
          />
          <span className="text-emerald-300 font-semibold tracking-tight">
            Fantasy Command Centre
          </span>
        </Link>

        <div className="flex items-center gap-3">
          {/* keep whatever controls you already had here (game select, login button, etc.) */}
        </div>
      </div>
    </header>
  );
}
