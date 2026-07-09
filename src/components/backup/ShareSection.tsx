import { useState } from 'react';
import { Button, Banner } from '@douyinfe/semi-ui';
import { ShareExportModal } from './ShareExportModal';
import { ShareImportModal } from './ShareImportModal';

/**
 * 分享导出/导入入口区块：backup tab 内与 LocalBackupSection 并列。
 * 「导出分享包」→ ShareExportModal（选工作区/分类 + 上下文 checkbox）；
 * 「导入分享包」→ ShareImportModal（接收方预览 + 勾选 + background 合并导入）。
 */
export function ShareSection() {
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  return (
    <div style={{ marginTop: 24 }}>
      <Banner
        type="info"
        description="把部分工作区或分类打包成分享包发给同事，对方导入即合并到他的库，不影响现有数据。"
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <Button theme="solid" onClick={() => setExportOpen(true)}>导出分享包</Button>
        <Button onClick={() => setImportOpen(true)}>导入分享包</Button>
      </div>
      <ShareExportModal visible={exportOpen} onClose={() => setExportOpen(false)} />
      <ShareImportModal visible={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  );
}
