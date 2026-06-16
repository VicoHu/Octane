import { useState, useEffect, useRef } from 'react';
import { extractHostname } from '../utils/url';

export interface CurrentTabContext {
  /** 当前 tab 的 hostname；url 不可用（无权限/非 http(s)）时为 null */
  hostname: string | null;
  /** 首次取 tab 期间为 true */
  loading: boolean;
}

/**
 * 监听当前 active tab，提取 hostname 供 side panel 联动匹配书签。
 *
 * - M1：tabs.query 返回的 url 可能为 undefined（无 host permission 的受限页），
 *   hostname 设为 null，不报错（渲染层降级"此页面不支持联动"）
 * - M2：快速切 tab 时并发 query，用递增序列号丢弃过期结果（后到达的前次结果不覆盖）
 * - M3：onUpdated 仅在 status === 'complete' 时刷新，忽略 loading 阶段的冗余触发
 *
 * @returns hostname + loading
 */
export function useCurrentTabContext(): CurrentTabContext {
  const [hostname, setHostname] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seqRef = useRef(0);

  useEffect(() => {
    let mounted = true;
    seqRef.current = 0;

    async function refresh() {
      const mySeq = ++seqRef.current;
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      // M2：丢弃过期结果（快速切 tab 时，前一次 query 后到达）
      if (mySeq !== seqRef.current || !mounted) return;
      const url = tabs[0]?.url;
      setHostname(url ? extractHostname(url) : null);
      setLoading(false);
    }

    refresh();

    const onActivated = () => refresh();
    const onUpdated = (_tabId: number, changeInfo: { status?: string }) => {
      // M3：仅 complete 触发刷新，忽略 loading 阶段
      if (changeInfo.status === 'complete') refresh();
    };
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);

    return () => {
      mounted = false;
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, []);

  return { hostname, loading };
}
