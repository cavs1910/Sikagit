import { Menu, X } from 'lucide-react';
import { useMobile } from '../../hooks/useMobile';
import { useRepoStore } from '../../store/repoStore';
import { EditorDraftGuard } from '../files/EditorDraftGuard';
import { refreshAISettings } from '../../lib/aiSettings';
import { useEffect, useCallback, useState } from 'react';
import { Sidebar } from './Sidebar';
import { StatusBar } from './StatusBar';
import { MainContent } from './MainContent';
import { ResizeHandle } from '../ui/ResizeHandle';
import { useUIStore } from '../../store/uiStore';
import { useUrlSelection } from '../../lib/urlSelection';
import { installOpenRepoRefreshListeners } from '../../lib/repoRefresh';
import { cn } from '../../lib/utils';

export function AppShell() {
  const { sidebarOpen, sidebarWidth, setSidebarWidth, fontSize, demoMode } = useUIStore();

  const mobile = useMobile();
  const [menuOpen, setMenuOpen] = useState(false);
  const activeRepoId = useRepoStore(s => s.activeRepoId);
  useEffect(() => { setMenuOpen(false); }, [activeRepoId, mobile]);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuOpen(false); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [menuOpen]);

  // Fetches repos + projects and keeps the open project/repo in sync with the URL.
  useUrlSelection();
  useEffect(()=>{void refreshAISettings(); const refresh=()=>{void refreshAISettings();}; window.addEventListener('focus',refresh); return ()=>window.removeEventListener('focus',refresh);},[]);

  // Reload the open repo's commits/branches/status when the tab becomes visible
  // or the window regains focus (rate-limited per repo inside).
  useEffect(() => installOpenRepoRefreshListeners(), []);

  // Apply font size to <html> root so all rem-based sizes scale
  useEffect(() => {
    document.documentElement.style.fontSize = `${fontSize}px`;
  }, [fontSize]);

  const handleSidebarResize = useCallback((delta: number) => {
    setSidebarWidth(sidebarWidth + delta);
  }, [sidebarWidth, setSidebarWidth]);

  return (
    <div className={cn('app-shell flex flex-col h-dvh overflow-hidden', demoMode && 'demo-mode')}>
      <EditorDraftGuard />
      {mobile && <header className="h-12 flex items-center gap-3 px-3 py-1 border-b border-border bg-bg-secondary shrink-0">
        <button aria-label={menuOpen ? 'Close repositories' : 'Open repositories'} aria-expanded={menuOpen} aria-controls="mobile-repositories" onClick={() => setMenuOpen(open => !open)} className="p-2 rounded hover:bg-bg-tertiary">
          {menuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
        <span className="font-semibold text-sm">SikaGit</span>
      </header>}
      {mobile && menuOpen && <>
        <button aria-label="Close repositories" className="fixed inset-0 top-12 bg-black/60 z-30" onClick={() => setMenuOpen(false)} />
        <div id="mobile-repositories" className="fixed top-12 bottom-0 left-0 w-[min(85vw,320px)] z-40"><Sidebar onNavigate={() => setMenuOpen(false)} /></div>
      </>}
      <div className="flex flex-1 overflow-hidden">
        {!mobile && sidebarOpen && (
          <>
            <div style={{ width: sidebarWidth }} className="flex-shrink-0">
              <Sidebar />
            </div>
            <ResizeHandle direction="horizontal" onResize={handleSidebarResize} />
          </>
        )}
        <MainContent />
      </div>
      <StatusBar />
    </div>
  );
}
