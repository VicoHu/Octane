import React, { useEffect, useRef, useState, useImperativeHandle } from 'react';
import { Form, Banner, useFieldState } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { Bookmark, Workspace, Category } from '@/shared/types';
import { BookmarkFaviconPreview } from '@/newtab/components/BookmarkFaviconPreview';
import styles from './index.module.css';

/** 面板提交值 */
export interface BookmarkOpsPanelSubmit {
  url: string;
  name: string;
  description: string;
  workspaceId: string;
  categoryId: string;
}

/** 通过 ref 暴露给父 Modal footer 的命令接口（不外泄 Semi FormApi） */
export interface BookmarkOpsPanelHandle {
  /** 触发 Semi Form 提交（校验通过后走 onSubmit） */
  submit: () => void;
}

export interface BookmarkOpsPanelProps {
  /** 编辑的书签；initValues 锚定它的 workspaceId/categoryId */
  bookmark: Bookmark;
  /** 全量工作区（来自 useWorkspace.workspaces） */
  workspaces: Workspace[];
  /** 异步加载目标工作区分类 */
  categoriesLoader: (workspaceId: string) => Promise<Category[]>;
  /** 提交回调；父决定调 moveBookmark vs updateBookmark */
  onSubmit: (values: BookmarkOpsPanelSubmit) => void;
}

/**
 * 书签操作面板：归属位置（工作区级联分类） + 书签信息（URL/名称/描述）。
 *
 * 级联 Select 数据源是组件内部 state（非 useWorkspace.categories，后者是当前工作区作用域），
 * 切换工作区时调 categoriesLoader 加载目标工作区分类，加载前清空防残留。
 */
export const BookmarkOpsPanel = React.forwardRef<
  BookmarkOpsPanelHandle,
  BookmarkOpsPanelProps
>(function BookmarkOpsPanel(props, ref) {
  const { bookmark, workspaces, categoriesLoader, onSubmit } = props;

  const [api, setApi] = useState<FormApi<BookmarkOpsPanelSubmit> | null>(null);
  // 目标工作区分类列表（级联 Select 数据源，独立于 useWorkspace.categories）
  const [targetCategories, setTargetCategories] = useState<Category[]>([]);
  const [loadingCategories, setLoadingCategories] = useState(false);
  // 竞态防护：快速切换工作区 Select 时，丢弃过期请求的结果（最后一次切换胜出）
  const loadReqId = useRef(0);

  // 拉取指定工作区分类；加载前清空防残留
  const loadCategories = async (workspaceId: string) => {
    if (!workspaceId) {
      setTargetCategories([]);
      return;
    }
    const reqId = ++loadReqId.current;
    setLoadingCategories(true);
    setTargetCategories([]);
    try {
      const list = await categoriesLoader(workspaceId);
      // 仅当本次仍是最新请求时才落地（避免快速切换 ws 时旧请求脏写）
      if (reqId === loadReqId.current) setTargetCategories(list);
      return list;
    } finally {
      if (reqId === loadReqId.current) setLoadingCategories(false);
    }
  };

  // 挂载时预加载书签原属工作区分类，使初始分类 Select 有选项
  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    void loadCategories(bookmark.workspaceId);
    // 仅挂载时执行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 工作区 Select onChange：加载目标工作区分类 + 设置分类默认值
  // Semi Form.Select onChange 入参为选中值（单选为 string）
  const handleWorkspaceChange = async (value: unknown) => {
    const wsId = typeof value === 'string' ? value : String(value ?? '');
    const list = await loadCategories(wsId);
    if (!api) return;
    // 原属工作区恢复原 categoryId；否则选首个分类
    if (wsId === bookmark.workspaceId) {
      api.setValue('categoryId', bookmark.categoryId);
    } else if (list && list.length > 0) {
      api.setValue('categoryId', list[0]!.id);
    } else {
      api.setValue('categoryId', '');
    }
  };

  // 暴露 submit()（不外泄 Semi FormApi）
  useImperativeHandle(
    ref,
    () => ({
      submit: () => {
        api?.submitForm();
      },
    }),
    [api],
  );

  const categoryEmpty = !loadingCategories && targetCategories.length === 0;

  return (
    <Form<BookmarkOpsPanelSubmit>
      key={bookmark.id}
      getFormApi={setApi}
      initValues={{
        workspaceId: bookmark.workspaceId,
        categoryId: bookmark.categoryId,
        url: bookmark.url ?? '',
        name: bookmark.name ?? '',
        description: bookmark.description ?? '',
      }}
      onSubmit={(values) => onSubmit(values)}
    >
      {/* 归属位置（在上）：工作区级联分类 */}
      <Form.Section text="归属位置" className={styles.section}>
        <Form.Select
          field="workspaceId"
          label="工作区"
          style={{ width: '100%' }}
          optionList={workspaces.map((w) => ({ value: w.id, label: `${w.icon} ${w.name}` }))}
          getPopupContainer={() => document.querySelector('.semi-modal') ?? document.body}
          onChange={handleWorkspaceChange}
        />
        <Form.Select
          field="categoryId"
          label="分类"
          style={{ width: '100%' }}
          loading={loadingCategories}
          disabled={categoryEmpty}
          placeholder={categoryEmpty ? '该工作区暂无分类' : '请选择分类'}
          optionList={targetCategories.map((c) => ({ value: c.id, label: `${c.icon} ${c.name}` }))}
          getPopupContainer={() => document.querySelector('.semi-modal') ?? document.body}
          // 防呆：空分类(目标工作区 0 分类)时 categoryId 为空，required 校验拦截提交，避免孤儿书签
          rules={[{ required: true, message: '请选择目标分类' }]}
        />
        {categoryEmpty ? (
          <Banner
            className={styles.banner}
            fullMode={false}
            type="warning"
            bordered
            description="目标工作区无分类，请先创建"
          />
        ) : null}
      </Form.Section>

      {/* 书签信息（在下）：URL/名称/描述 */}
      <Form.Section text="书签信息">
        {/* favicon 预览 + 刷新（订阅 url 字段当前值，跟随用户编辑） */}
        <Form.Slot label="图标">
          <BookmarkFaviconPreviewControl />
        </Form.Slot>
        <Form.Input
          field="url"
          label="URL"
          placeholder="https://example.com"
          rules={[{ required: true, message: '请输入 URL' }]}
        />
        <Form.Input field="name" label="名称" placeholder="留空则使用域名" />
        <Form.TextArea field="description" label="描述" placeholder="可选" maxLength={200} />
      </Form.Section>
    </Form>
  );
});

/**
 * 订阅 Semi Form 的 url 字段当前值，喂给 BookmarkFaviconPreview。
 *
 * Semi FormApi 无 subscribe API；改用 Semi 官方 useFieldState hook，
 * 在 Form context 内渲染时自动跟随字段值变化重渲染。
 */
function BookmarkFaviconPreviewControl() {
  const { value } = useFieldState('url');
  return <BookmarkFaviconPreview url={(value as string) ?? ''} />;
}
