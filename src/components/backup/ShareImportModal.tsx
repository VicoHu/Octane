import { useRef, type ChangeEvent } from 'react';
import { Modal, Button, Banner, Spin, Typography } from '@douyinfe/semi-ui';
import { SelectionTree } from './SelectionTree';
import { shareStats } from './shareSelection';
import { useShare } from '@/store/useShare';

interface ShareImportModalProps {
  visible: boolean;
  onClose: () => void;
}

/**
 * 接收方导入分享包 Modal：消费 useShare 状态机（Task7）。
 * 选文件 → 预览（数量+安全提示）→ 勾选 → background 合并导入。状态源在 store。
 */
export function ShareImportModal({ visible, onClose }: ShareImportModalProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const {
    importStatus: status, importData: data, importSelection: selection, importResult: result, importError: errorMessage,
    pickImportFile, setImportSelection, runImport, resetImport,
  } = useShare();

  const handlePick = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) pickImportFile(f);
    e.target.value = '';
  };

  const stats = data
    ? shareStats(data.workspaces, data.categories, data.bookmarks, selection)
    : { ws: 0, cat: 0, bm: 0 };

  // footer 按 status 动态：success=关闭；previewing|importing=取消+合并导入（importing 时 loading）；其余=关闭
  const footer =
    status === 'success' ? (
      <Button onClick={() => { resetImport(); onClose(); }}>关闭</Button>
    ) : status === 'previewing' || status === 'importing' ? (
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Button onClick={() => { resetImport(); onClose(); }} disabled={status === 'importing'}>取消</Button>
        <Button
          theme="solid"
          loading={status === 'importing'}
          disabled={stats.ws === 0 && stats.cat === 0}
          onClick={runImport}
        >
          合并导入{stats.ws > 0 ? ` ${stats.ws} 个工作区` : ''}
        </Button>
      </div>
    ) : (
      <Button onClick={() => { resetImport(); onClose(); }}>关闭</Button>
    );

  return (
    <Modal title="导入分享包" visible={visible} onCancel={() => { resetImport(); onClose(); }} maskClosable={false} width={560} footer={footer}>
      <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={handlePick} />

      {status === 'idle' && (
        <Button onClick={() => fileRef.current?.click()}>选择分享包文件</Button>
      )}
      {status === 'parsing' && <Spin />}
      {status === 'error' && errorMessage && (
        <Typography.Text type="danger" role="alert">{errorMessage}</Typography.Text>
      )}
      {status === 'previewing' && data && (
        <>
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
            来自分享 · 合并到你的库，<strong>不覆盖</strong>现有数据。
          </Typography.Text>
          {data.cryptoMetadata && (
            <Banner type="warning" description="此分享包含加密笔记，需与发送方相同主密码才能查看。" style={{ marginBottom: 8 }} />
          )}
          {data.workspaces.length === 0 ? (
            <Typography.Text type="tertiary">这个分享包是空的</Typography.Text>
          ) : (
            <SelectionTree
              workspaces={data.workspaces}
              categories={data.categories}
              bookmarks={data.bookmarks}
              value={selection}
              onChange={setImportSelection}
            />
          )}
        </>
      )}
      {status === 'success' && result && (
        <>
          <Typography.Text>
            ✓ 已导入 {result.workspaces} 个工作区 · {result.categories} 个分类 · {result.bookmarks} 个书签
          </Typography.Text>
          {result.skippedEncrypted > 0 && (
            <Banner type="warning" style={{ marginTop: 8 }}
              description={`${result.skippedEncrypted} 条加密笔记因本机加密设置不同未导入`} />
          )}
        </>
      )}
    </Modal>
  );
}
