import Link from "next/link";

const LEGAL_LINKS = [
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
  { href: "/refund-policy", label: "Refund Policy" },
] as const;

export function SiteFooter() {
  return (
    <footer className="border-t border-gray-200">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 text-sm text-gray-500 md:flex-row">
        <p>&copy; {new Date().getFullYear()} GrowEazzy. India.</p>
        <nav className="flex gap-4">
          {LEGAL_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="hover:text-gray-800">
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
