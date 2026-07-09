import { useState } from 'react';
import { Button, Banner } from '@douyinfe/semi-ui';
import { ShareExportModal } from './ShareExportModal';

/**
 * 分享导出入口区块：backup tab 内与 LocalBackupSection 并列。
 * 「导出分享包」按钮 → 弹 ShareExportModal（选工作区/分类 + 上下文 checkbox）。
 */
export function ShareSection() {
  const [shareOpen, setShareOpen] = useState(false);
  return (
    <div style={{ marginTop: 24 }}>
      <Banner
        type="info"
        description="把部分工作区或分类打包成分享包发给同事，对方导入即合并到他的库，不影响现有数据。"
      />
      <div style={{ marginTop: 12 }}>
        <Button theme="solid" onClick={() => setShareOpen(true)}>导出分享包</Button>
      </div>
      <ShareExportModal visible={shareOpen} onClose={() => setShareOpen(false)} />
    </div>
  );
}
