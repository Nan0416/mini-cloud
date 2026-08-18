import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { OfflineBanner } from './offline-banner';
import { Sidebar } from './sidebar';
import { TopBar } from './top-bar';

export function AppShell() {
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <TopBar onOpenNav={() => setNavOpen(true)} />
      <OfflineBanner />
      <div className="flex flex-1">
        <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-[100rem] space-y-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
