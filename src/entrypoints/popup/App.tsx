import { useEffect, useState } from 'react';
import type { View } from './navigation';
import HomeView from './views/HomeView';
import SaveBookmarkView from './views/SaveBookmarkView';
import SettingsView from './views/SettingsView';
import { UnlockModal } from '@/components/UnlockModal';
import { useCrypto } from '@/store/useCrypto';
import styles from './popup.module.css';

export default function App() {
  const [view, setView] = useState<View>('home');
  const checkStatus = useCrypto((s) => s.checkStatus);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  return (
    <div className={styles.popup}>
      <UnlockModal />
      {view === 'home' && <HomeView onNavigate={setView} />}
      {view === 'save' && <SaveBookmarkView onBack={() => setView('home')} />}
      {view === 'settings' && <SettingsView onBack={() => setView('home')} />}
    </div>
  );
}
