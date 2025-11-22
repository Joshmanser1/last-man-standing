// src/components/Footer.tsx
export default function Footer() {
  return (
    <footer className="mt-10 border-t border-slate-200">
      <div className="container-page py-6 text-sm text-slate-600 flex items-center justify-between">
        <span>© {new Date().getFullYear()} Fantasy Command Centre</span>
        <span className="text-slate-400">v1.0</span>
      </div>
    </footer>
  );
}
