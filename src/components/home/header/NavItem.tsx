import Link from 'next/link';
type P = { pathname: string | null; href: string; label: string; className?: string };
const normalize = (value: string | null) => !value || value === '/' ? '/' : value.replace(/\/+$/, '');
export function NavItem({ pathname, href, label, className = '' }: P) {
  const current = normalize(pathname);
  const active = href === '/' ? current === '/' : current === href || current.startsWith(href + '/');
  return <Link href={href} className={('v4-nav-link ' + className + (active ? ' is-active' : '')).trim()} aria-current={active ? 'page' : undefined}>{label}</Link>;
}
