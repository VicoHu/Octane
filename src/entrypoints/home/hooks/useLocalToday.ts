import { useEffect, useState } from 'react';

function getLocalToday(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function millisecondsUntilNextMidnight(): number {
  const nextMidnight = new Date();
  nextMidnight.setHours(24, 0, 0, 0);
  return nextMidnight.getTime() - Date.now();
}

/** 返回本地日历日期，并在跨午夜或页面重新可见时刷新。 */
export function useLocalToday(): string {
  const [today, setToday] = useState(getLocalToday);

  useEffect(() => {
    let timer = window.setTimeout(function refreshAtMidnight() {
      setToday(getLocalToday());
      timer = window.setTimeout(refreshAtMidnight, millisecondsUntilNextMidnight());
    }, millisecondsUntilNextMidnight());
    const refreshOnVisibility = () => setToday(getLocalToday());
    document.addEventListener('visibilitychange', refreshOnVisibility);

    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', refreshOnVisibility);
    };
  }, []);

  return today;
}
