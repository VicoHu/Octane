import { useCurrentTabContext } from './hooks/useCurrentTabContext';

/**
 * Side Panel 根组件（占位）。
 * P2 将扩展为四状态（联动正常态 / 空 / 加密 / skeleton）+ 按书签分组渲染 +
 * openPanelOnActionClick 配置。当前仅显示当前 tab hostname 以验证 entrypoint 注册。
 */
export default function App() {
  const { hostname, loading } = useCurrentTabContext();
  return (
    <div style={{ padding: 16, fontFamily: 'system-ui, sans-serif' }}>
      {loading ? '加载中…' : hostname ?? '此页面不支持联动'}
    </div>
  );
}
