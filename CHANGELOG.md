# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/).

## [0.1.0] - 2026-06-11

### Added

**项目初始化**
- 初始化项目骨架（Vite + React 19 + TypeScript 6 + Chrome Extension MV3）
- 添加 Prettier、.gitignore、MCP 配置

**基础设施层（P1）**
- 添加数据模型类型定义（Workspace, Category, Bookmark, Note, CryptoMetadata）
- 实现 IndexedDB 封装层：连接管理（单例模式）、5 张表、索引、级联删除（Workspace→Category→Bookmark→Note）、配额监控
- 实现 CryptoService：PBKDF2 密钥派生（600K 迭代）、AES-GCM-256 加密/解密、chrome.storage.session 会话密钥管理、主密码设置/解锁/修改

**Service 层**
- WorkspaceService：工作区 CRUD + 级联删除
- CategoryService：分类 CRUD + 级联删除
- BookmarkService：书签 CRUD + Google Favicon API
- NoteService：笔记 CRUD，自动处理加密/解密，对业务层只暴露明文接口
- Markdown 渲染工具：marked + DOMPurify 安全过滤

**Store 层（Zustand）**
- useWorkspace：工作区/分类状态管理
- useBookmarks：书签列表、CRUD、Favicon 自动补充
- useCrypto：加密状态（是否设置密码、是否解锁）
- useSearch：搜索查询状态

**UI 层（Semi Design）**
- Sidebar：工作区选择器 + 分类列表 + 创建/删除操作
- Content：搜索栏 + 三列卡片网格 + 添加书签弹窗 + 空状态
- BookmarkCard：Favicon + 名称 + URL + 描述 + 加密锁图标
- NoteEditor：侧滑面板、Markdown 编辑/预览切换、加密开关、自动保存
- UnlockModal：主密码设置/解锁弹窗
- EmptyState：统一空状态组件

**测试**
- IndexedDB CRUD + 级联删除测试（fake-indexeddb）
- CryptoService 加密/解密往返测试
- Service 层集成测试
- Markdown 渲染工具测试

**其他**
- 添加扩展图标资源（16/48/128px + SVG）
- vite.config.ts 配置 `base: './'` 相对路径
- 添加开发文档（P1 基础设施计划、P2 UI 组件计划）
