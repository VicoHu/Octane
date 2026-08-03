import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Toast } from "@/components/ui/toast";

// Semi UI 间接拉入 lottie-web，jsdom 无 canvas 实现会崩，统一 mock。
vi.mock("lottie-web", () => ({
  default: {
    loadAnimation: () => ({
      destroy() {},
      play() {},
      pause() {},
      addEventListener() {},
      removeEventListener() {},
    }),
    destroy() {},
    registerAnimation() {},
  },
}));

// 仅 mock Toast（项目测试规范：真实渲染 ui 组件，只 mock Toast 副作用边界）
vi.mock("@/components/ui/toast", () => ({
  Toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), close: vi.fn() },
}));

// mocks
const store = vi.hoisted(() => ({
  testCloudConnection: vi.fn(),
  saveCloudConfig: vi.fn(),
  clearCloudConfig: vi.fn(),
  uploadCloudBackup: vi.fn(),
  restoreFromCloud: vi.fn(),
  applyCloudRestore: vi.fn(),
  listCloudBackups: vi.fn(),
  restoreCloudVersion: vi.fn(),
  deleteCloudBackup: vi.fn(),
}));
vi.mock("@/store/useBackup", () => ({
  useBackup: { getState: () => store },
}));

// CloudBackupSection 读 useCrypto（主密码状态 + 解锁入口）
const cryptoState = vi.hoisted(() => ({
  unlocked: false,
  passwordSet: false,
  openUnlockModal: vi.fn(),
}));
vi.mock("@/store/useCrypto", () => ({
  useCrypto: (sel: (s: Record<string, unknown>) => unknown) => sel(cryptoState),
}));

const cloudSvc = vi.hoisted(() => ({ getLastBackupAt: vi.fn(), getCloudConfig: vi.fn() }));
vi.mock("@/services/CloudStorageService", () => ({
  getLastBackupAt: cloudSvc.getLastBackupAt,
  getCloudConfig: cloudSvc.getCloudConfig,
}));

// 两个 provider：s3 含 select(s3Preset)，webdav 含 select(webdavPreset)，验证动态 TABS + select 渲染 + 通用收集
const providers = vi.hoisted(() => ({
  s3: {
    id: "s3",
    label: "S3 兼容存储",
    configFields: [
      { name: "s3Preset", label: "服务商", type: "select" as const, options: ["aliyun", "tencent"], required: true },
      { name: "region", label: "Region", type: "text" as const, required: true },
      { name: "bucket", label: "Bucket", type: "text" as const, required: true },
      { name: "accessKeyId", label: "AccessKeyId", type: "text" as const, required: true },
      { name: "accessKeySecret", label: "AccessKeySecret", type: "password" as const, required: true },
    ],
  },
  webdav: {
    id: "webdav",
    label: "WebDAV",
    configFields: [
      { name: "webdavPreset", label: "服务商", type: "select" as const, options: ["jianguoyun"], required: true },
      { name: "username", label: "账号", type: "text" as const, required: true },
      { name: "password", label: "应用密码", type: "password" as const, required: true },
    ],
  },
}));
vi.mock("@/services/cloud/providers", () => ({
  // TABS 由 Object.keys(cloudProviders) 生成，故 mock 需同时提供 cloudProviders + getCloudProvider
  cloudProviders: providers,
  getCloudProvider: (id: "s3" | "webdav") => providers[id],
}));

import { CloudBackupSection } from "../CloudBackupSection";
import type { BackupData } from "@/shared/types";
import type { ValidatedBackup } from "@/services/BackupService";

const okData: BackupData = { workspaces: [], categories: [], bookmarks: [], contexts: [], cryptoMetadata: null, taskLists: [], tasks: [], checklistItems: [], taskTags: [], taskTagAssignments: [] };
const okBackup: ValidatedBackup = { ok: true, kind: 'backup', version: 6, exportedAt: 1000, appVersion: '0.0.0', containsTodoData: false, isLegacyWithoutTodo: false, data: okData };

const btn = (text: string): HTMLButtonElement => screen.getByText(text).closest("button") as HTMLButtonElement;

beforeEach(() => {
  Object.values(store).forEach((m) => (m as ReturnType<typeof vi.fn>).mockReset());
  cloudSvc.getLastBackupAt.mockReset();
  cloudSvc.getCloudConfig.mockReset();
  cloudSvc.getCloudConfig.mockResolvedValue(null);
  vi.mocked(Toast.error).mockReset();
  vi.mocked(Toast.success).mockReset();
  cryptoState.unlocked = true;
  cryptoState.passwordSet = true;
  cryptoState.openUnlockModal = vi.fn();
  cloudSvc.getLastBackupAt.mockResolvedValue(null);
});

describe("CloudBackupSection", () => {
  it("渲染两个服务商 Tab（动态生成）+ 当前 provider 字段 label", async () => {
    render(<CloudBackupSection />);
    expect(await screen.findByText("S3 兼容存储")).toBeTruthy();
    expect(screen.getByText("WebDAV")).toBeTruthy();
    expect(screen.getByText("Region")).toBeTruthy();
  });

  it("S3 与 WebDAV 均渲染 preset 下拉（select 分支）", async () => {
    render(<CloudBackupSection />);
    expect(await screen.findByText("S3 兼容存储")).toBeTruthy();
    // s3 preset 下拉
    expect(screen.getAllByRole("combobox").length).toBeGreaterThanOrEqual(1);
    // 切到 webdav 也有下拉
    await userEvent.click(screen.getByText("WebDAV"));
    expect(await screen.findByText("应用密码")).toBeTruthy();
    expect(screen.getAllByRole("combobox").length).toBeGreaterThanOrEqual(1);
  });

  it("点击「WebDAV」Tab → 切换并显示 WebDAV 字段（账号）", async () => {
    render(<CloudBackupSection />);
    expect(await screen.findByText("S3 兼容存储")).toBeTruthy();
    expect(screen.queryByText("账号")).toBeNull();
    await userEvent.click(screen.getByText("WebDAV"));
    expect(await screen.findByText("账号")).toBeTruthy();
  });

  it("handleSave 通用收集 configFields：s3Preset(select) 未选时按 required 拦截（证明 select 进了收集循环，不再硬编码字段集）", async () => {
    render(<CloudBackupSection />);
    expect(await screen.findByText("S3 兼容存储")).toBeTruthy();
    await userEvent.click(btn("保存配置"));
    await waitFor(() => expect(Toast.error).toHaveBeenCalledWith("请填写 服务商"));
    expect(store.saveCloudConfig).not.toHaveBeenCalled();
  });

  it("handleTest 错误文案 surfacing：provider 抛「桶不存在」→ Toast.error 透传该消息", async () => {
    store.testCloudConnection.mockRejectedValue(new Error("S3 桶不存在（404）"));
    render(<CloudBackupSection />);
    expect(await screen.findByText("S3 兼容存储")).toBeTruthy();
    await userEvent.click(btn("测试连接"));
    await waitFor(() => expect(Toast.error).toHaveBeenCalledWith("S3 桶不存在（404）"));
  });

  it("未解锁 → 显示 Banner + 内联解锁入口 + 操作按钮 disabled", async () => {
    cryptoState.unlocked = false;
    render(<CloudBackupSection />);
    expect(await screen.findByText(/请先解锁/)).toBeTruthy();
    expect(btn("解锁主密码")).toBeTruthy();
    expect(btn("测试连接").disabled).toBe(true);
    expect(btn("上传备份").disabled).toBe(true);
  });

  it("未设置主密码 → Banner 文案为「请先设置」+ 内联「设置主密码」按钮", async () => {
    cryptoState.unlocked = false;
    cryptoState.passwordSet = false;
    render(<CloudBackupSection />);
    expect(await screen.findByText(/请先设置/)).toBeTruthy();
    expect(btn("设置主密码")).toBeTruthy();
  });

  it("解锁后从已保存配置回填表单（刷新后应展示已存凭证）", async () => {
    cloudSvc.getCloudConfig.mockResolvedValue({
      s3Preset: "aliyun",
      region: "oss-cn-hangzhou",
      bucket: "saved-bucket",
      accessKeyId: "SAVEDAK",
      accessKeySecret: "SAVEDSK",
    });
    render(<CloudBackupSection />);
    expect(await screen.findByDisplayValue("saved-bucket")).toBeTruthy();
    expect(screen.getByDisplayValue("SAVEDAK")).toBeTruthy();
  });

  it("重新打开已保存的坚果云配置 → 完整回显且 Select 始终受控", async () => {
    const user = userEvent.setup();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    cloudSvc.getCloudConfig.mockImplementation(async (id: "s3" | "webdav") =>
      id === "webdav" ? { webdavPreset: "jianguoyun", username: "saved-user", password: "saved-password" } : null,
    );

    try {
      render(<CloudBackupSection />);
      await user.click(screen.getByText("WebDAV"));

      expect(await screen.findByDisplayValue("saved-user")).toBeInTheDocument();
      expect(screen.getByDisplayValue("saved-password")).toBeInTheDocument();
      expect(screen.getByRole("combobox")).toHaveTextContent("坚果云");
      expect(errorSpy.mock.calls.flat().join(" ")).not.toMatch(/uncontrolled.*controlled/i);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("点击「从云恢复」→ 下载解析成功 → 弹破坏性确认 Modal（未勾选时确认禁用）", async () => {
    store.restoreFromCloud.mockResolvedValue(okBackup);
    render(<CloudBackupSection />);
    expect(await screen.findByText("上传备份")).toBeTruthy();
    await userEvent.click(btn("从云恢复"));
    await waitFor(() => expect(store.restoreFromCloud).toHaveBeenCalledWith("s3"));
    expect(await screen.findByText("确认覆盖全部数据")).toBeTruthy();
    const confirmBtn = btn("确认覆盖");
    expect(confirmBtn.disabled).toBe(true);
    await userEvent.click(screen.getByText("我了解此操作不可撤销"));
    await waitFor(() => expect(confirmBtn.disabled).toBe(false));
  });

  it("确认覆盖 → applyCloudRestore", async () => {
    store.restoreFromCloud.mockResolvedValue(okBackup);
    store.applyCloudRestore.mockResolvedValue(undefined);
    render(<CloudBackupSection />);
    expect(await screen.findByText("上传备份")).toBeTruthy();
    await userEvent.click(btn("从云恢复"));
    expect(await screen.findByText("确认覆盖")).toBeTruthy();
    await userEvent.click(screen.getByText("我了解此操作不可撤销"));
    await userEvent.click(btn("确认覆盖"));
    await waitFor(() => expect(store.applyCloudRestore).toHaveBeenCalledWith(okData));
  });

  describe("版本历史 Dialog", () => {
    const version = {
      id: "octane-backup-d1-1784622432000-aaaaaaaa",
      key: "k1",
      device: "d1",
      timestamp: 1784622432000,
      size: 2048,
    };

    it("点击「历史版本」→ listCloudBackups → 列表（时间倒序 + 大小格式化 + 恢复/删除按钮）", async () => {
      store.listCloudBackups.mockResolvedValue([
        version,
        { ...version, id: "octane-backup-d1-1784622000000-bbbbbbbb", timestamp: 1784622000000, size: 1024 },
      ]);
      render(<CloudBackupSection />);
      expect(await screen.findByText("上传备份")).toBeTruthy();
      await userEvent.click(btn("历史版本"));
      await waitFor(() => expect(store.listCloudBackups).toHaveBeenCalledWith("s3"));
      // 最新版本时间在前
      expect(await screen.findByText(new Date(1784622432000).toLocaleString())).toBeTruthy();
      expect(screen.getByText("2.0 KB")).toBeTruthy();
      expect(screen.getAllByRole("button", { name: "恢复" })).toHaveLength(2);
      expect(screen.getAllByRole("button", { name: "删除" })).toHaveLength(2);
    });

    it("空列表 → 显示「暂无历史版本」", async () => {
      store.listCloudBackups.mockResolvedValue([]);
      render(<CloudBackupSection />);
      expect(await screen.findByText("上传备份")).toBeTruthy();
      await userEvent.click(btn("历史版本"));
      expect(await screen.findByText("暂无历史版本")).toBeTruthy();
    });

    it("加载失败 → 显示错误 + 重试成功", async () => {
      store.listCloudBackups.mockRejectedValueOnce(new Error("网络错误")).mockResolvedValueOnce([]);
      render(<CloudBackupSection />);
      expect(await screen.findByText("上传备份")).toBeTruthy();
      await userEvent.click(btn("历史版本"));
      expect(await screen.findByText(/网络错误/)).toBeTruthy();
      await userEvent.click(btn("重试"));
      await waitFor(() => expect(store.listCloudBackups).toHaveBeenCalledTimes(2));
      expect(await screen.findByText("暂无历史版本")).toBeTruthy();
    });

    it("恢复指定版本 → restoreCloudVersion → 复用破坏性确认 Dialog", async () => {
      store.listCloudBackups.mockResolvedValue([version]);
      store.restoreCloudVersion.mockResolvedValue(okBackup);
      render(<CloudBackupSection />);
      expect(await screen.findByText("上传备份")).toBeTruthy();
      await userEvent.click(btn("历史版本"));
      await waitFor(() => expect(store.listCloudBackups).toHaveBeenCalledWith("s3"));
      const restoreBtns = await screen.findAllByRole("button", { name: "恢复" });
      await userEvent.click(restoreBtns[0]!);
      await waitFor(() =>
        expect(store.restoreCloudVersion).toHaveBeenCalledWith("s3", "octane-backup-d1-1784622432000-aaaaaaaa"),
      );
      expect(await screen.findByText("确认覆盖全部数据")).toBeTruthy();
    });

    it("删除指定版本 → deleteCloudBackup + 刷新列表", async () => {
      store.listCloudBackups.mockResolvedValueOnce([version]).mockResolvedValueOnce([]);
      store.deleteCloudBackup.mockResolvedValue(undefined);
      render(<CloudBackupSection />);
      expect(await screen.findByText("上传备份")).toBeTruthy();
      await userEvent.click(btn("历史版本"));
      const deleteBtns = await screen.findAllByRole("button", { name: "删除" });
      await userEvent.click(deleteBtns[0]!);
      await waitFor(() =>
        expect(store.deleteCloudBackup).toHaveBeenCalledWith("s3", "octane-backup-d1-1784622432000-aaaaaaaa"),
      );
      expect(await screen.findByText("暂无历史版本")).toBeTruthy();
      await waitFor(() => expect(Toast.success).toHaveBeenCalled());
    });
  });
});
