import { useEffect, useState } from 'react';
import { Maximize, Minimize } from 'lucide-react';

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

export function MobileFullscreenButton() {
  const [fullscreen, setFullscreen] = useState(false);
  const [pageFullscreen, setPageFullscreen] = useState(false);

  useEffect(() => {
    const doc = document as FullscreenDocument;
    const sync = () => setFullscreen(Boolean(doc.fullscreenElement || doc.webkitFullscreenElement));
    sync();
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('webkitfullscreenchange', sync);
      if ((doc.fullscreenElement || doc.webkitFullscreenElement) === document.documentElement) {
        const exit = doc.exitFullscreen || doc.webkitExitFullscreen;
        void Promise.resolve(exit?.call(doc)).catch(() => {});
      }
    };
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('mobile-page-fullscreen', pageFullscreen);
    if (!pageFullscreen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPageFullscreen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.documentElement.classList.remove('mobile-page-fullscreen');
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [pageFullscreen]);

  const active = fullscreen || pageFullscreen;
  const toggle = async () => {
    const doc = document as FullscreenDocument;
    const root = document.documentElement as FullscreenElement;
    if (pageFullscreen) {
      setPageFullscreen(false);
      return;
    }
    if (doc.fullscreenElement || doc.webkitFullscreenElement) {
      const exit = doc.exitFullscreen || doc.webkitExitFullscreen;
      try {
        await exit?.call(doc);
      } catch {
        // The browser's own exit control remains available.
      }
      return;
    }
    const enter = root.requestFullscreen || root.webkitRequestFullscreen;
    try {
      if (!enter) {
        setPageFullscreen(true);
        return;
      }
      await enter.call(root);
    } catch {
      // Browsers without page fullscreen can still expand the chart in the page.
      setPageFullscreen(true);
    }
  };

  const label = active ? 'Salir de pantalla completa' : 'Pantalla completa';
  return (
    <button
      type="button"
      onClick={() => void toggle()}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className="mobile-fullscreen-toggle inline-flex h-9 w-9 shrink-0 items-center justify-center rounded border border-border bg-background text-foreground focus-visible:outline-2 focus-visible:outline-amber-500"
    >
      {active ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
    </button>
  );
}
