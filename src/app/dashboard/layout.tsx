import type { Metadata } from 'next';
import { DashboardShell } from '@/components/platform/dashboard-shell';
export const metadata: Metadata = {
  title: 'Demo del producto',
  robots: { index: false, follow: false },
};
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <DashboardShell>{children}</DashboardShell>;
}
