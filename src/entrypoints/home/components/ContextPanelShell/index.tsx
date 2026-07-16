import type { ReactNode } from 'react';
import { Lock, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Drawer, DrawerClose, DrawerContent, DrawerTitle } from '@/components/ui/drawer';
import { Sheet, SheetClose, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { useMediaQuery } from '@/hooks/useMediaQuery';

import styles from './index.module.css';

interface ContextPanelShellProps {
  open: boolean;
  title: string;
  encrypted?: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  footer?: ReactNode;
}

interface PanelFrameProps {
  title: string;
  encrypted: boolean;
  closeControl: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}

function PanelFrame({ title, encrypted, closeControl, children, footer }: PanelFrameProps) {
  return (
    <div className={styles.frame}>
      <header className={styles.header}>
        <div className={styles.headingGroup}>
          <span className={styles.eyebrow}>书签上下文</span>
          <div className={styles.titleRow}>
            <h2 className={styles.title}>{title}</h2>
            {encrypted && <Lock aria-label="包含加密上下文" />}
          </div>
        </div>
        {closeControl}
      </header>
      <main className={styles.content}>{children}</main>
      {footer && <footer className={styles.footer}>{footer}</footer>}
    </div>
  );
}

export function ContextPanelShell({
  open,
  title,
  encrypted = false,
  onOpenChange,
  children,
  footer,
}: ContextPanelShellProps) {
  const isMobile = useMediaQuery('(max-width: 767px)');
  const accessibleTitle = `${title} 的上下文`;

  if (isMobile) {
    return (
      <Drawer
        open={open}
        onOpenChange={(nextOpen) => onOpenChange(nextOpen)}
        swipeDirection="down"
      >
        <DrawerContent
          data-has-footer={footer != null}
          className={`${styles.mobileDrawer} h-dvh max-h-dvh data-[swipe-direction=down]:rounded-none`}
        >
          <DrawerTitle className="sr-only">{accessibleTitle}</DrawerTitle>
          <PanelFrame
            title={title}
            encrypted={encrypted}
            footer={footer}
            closeControl={
              <DrawerClose
                render={<Button variant="ghost" size="icon" aria-label="关闭上下文面板" />}
              >
                <X />
              </DrawerClose>
            }
          >
            {children}
          </PanelFrame>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Sheet open={open} onOpenChange={(nextOpen) => onOpenChange(nextOpen)}>
      <SheetContent
        side="right"
        showCloseButton={false}
        data-has-footer={footer != null}
        className={`${styles.desktopSheet} data-[side=right]:w-screen data-[side=right]:sm:max-w-[1000px]`}
      >
        <SheetTitle className="sr-only">{accessibleTitle}</SheetTitle>
        <PanelFrame
          title={title}
          encrypted={encrypted}
          footer={footer}
          closeControl={
            <SheetClose
              render={<Button variant="ghost" size="icon" aria-label="关闭上下文面板" />}
            >
              <X />
            </SheetClose>
          }
        >
          {children}
        </PanelFrame>
      </SheetContent>
    </Sheet>
  );
}
