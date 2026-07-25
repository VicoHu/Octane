import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import {
  detectChannel,
  UPDATE_URL,
  CHANNEL_LABEL,
  type Channel,
} from '@/shared/distribution';
import { usePendingUpdate } from '@/entrypoints/home/hooks/usePendingUpdate';

// 项目无 @types/chrome：声明全局 chrome，最小子集断言（参考 ShortcutsSection.tsx）。
declare const chrome: unknown;
interface ChromeLike {
  runtime: {
    id: string;
    getManifest(): { version: string };
    requestUpdateCheck(): Promise<unknown>;
    reload(): void;
  };
  tabs: { create(opts: { url: string }): unknown };
}

const AUTHOR_URL = 'https://github.com/VicoHu';
const REPO_URL = 'https://github.com/VicoHu/Octane';
const ISSUES_URL = 'https://github.com/VicoHu/Octane/issues';
const DISCUSS_URL = 'https://discuss.vectorcube.vip';

/** 商店更新兜底：手动到扩展管理页点「更新」。 */
const EXTENSIONS_PAGE_URL = 'chrome://extensions';

/** 关于 Octane：版本/渠道 + 作者/仓库/反馈 + 新版本提示 + 按渠道前往更新页。 */
export function AboutSection() {
  const c = chrome as unknown as ChromeLike;
  const version = c.runtime.getManifest().version;
  const channel: Channel = detectChannel(c.runtime.id);
  const { version: pendingVersion } = usePendingUpdate();
  const [updating, setUpdating] = useState(false);

  const open = (url: string) => c.tabs.create({ url });

  // pendingUpdate 存在即证明有更新；requestUpdateCheck 结果（throttled/异常）一律忽略。
  // reload() 会销毁当前页面，updating 通常不会回到 false（页面已重载为新版）。
  const triggerUpdate = async () => {
    setUpdating(true);
    try {
      await c.runtime.requestUpdateCheck();
    } catch {
      // 忽略：不依赖检查结果
    }
    c.runtime.reload();
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="text-lg font-semibold">
          Octane <span className="font-normal text-muted-foreground">v{version}</span>
        </div>
        <div className="mt-1 text-sm text-muted-foreground">{CHANNEL_LABEL[channel]}</div>
      </div>

      <div className="space-y-1 text-sm">
        <Row label="作者" value="VicoHu" onClick={() => open(AUTHOR_URL)} />
        <Row label="开源仓库" value="VicoHu/Octane" onClick={() => open(REPO_URL)} />
        <Row label="技术问题反馈" value="GitHub Issues" onClick={() => open(ISSUES_URL)} />
        <Row label="社区讨论/反馈" value="Discuss论坛" onClick={() => open(DISCUSS_URL)} />
      </div>

      <UpdateStatus
        channel={channel}
        pendingVersion={pendingVersion}
        onOpen={open}
        onUpdate={triggerUpdate}
        updating={updating}
      />
    </div>
  );
}

function Row({ label, value, onClick }: { label: string; value: string; onClick: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-28 text-muted-foreground">{label}</span>
      <Button variant="link" className="h-auto p-0 text-foreground" onClick={onClick}>
        {value}
      </Button>
    </div>
  );
}

function UpdateStatus({
  channel,
  pendingVersion,
  onOpen,
  onUpdate,
  updating,
}: {
  channel: Channel;
  pendingVersion: string | null;
  onOpen: (url: string) => void;
  onUpdate: () => void;
  updating: boolean;
}) {
  // 手动安装：无自动更新（onUpdateAvailable 不触发），引导 Releases（优先级最高）
  if (channel === 'manual') {
    return (
      <div className="rounded-md border border-border p-3 text-sm">
        <div className="text-muted-foreground">
          手动安装不会收到自动更新提示，请定期查看新版本。
        </div>
        <Button className="mt-2" size="sm" onClick={() => onOpen(UPDATE_URL.manual)}>
          前往 GitHub Releases
        </Button>
      </div>
    );
  }
  // 商店用户收到 Chrome 推送的待装版本
  if (pendingVersion) {
    return (
      <div className="rounded-md border border-border p-3 text-sm">
        <div>新版本 v{pendingVersion} 可用</div>
        <div className="mt-1 text-muted-foreground">
          新版本将通过商店自动更新（审核可能有延迟）。
        </div>
        <Button className="mt-2" size="sm" onClick={onUpdate} disabled={updating}>
          {updating ? (
            <>
              <Spinner />
              更新中
            </>
          ) : (
            '立即更新'
          )}
        </Button>
        <div className="mt-1 text-muted-foreground">
          未生效？在
          <Button
            variant="link"
            className="h-auto px-1 py-0 align-baseline text-muted-foreground"
            onClick={() => onOpen(EXTENSIONS_PAGE_URL)}
          >
            扩展管理页
          </Button>
          手动更新（开发者模式 → 更新）
        </div>
      </div>
    );
  }
  // 商店用户无待装版本：已是最新（商店自动更新）
  return <div className="text-sm text-muted-foreground">已是最新版本（商店自动更新）。</div>;
}
