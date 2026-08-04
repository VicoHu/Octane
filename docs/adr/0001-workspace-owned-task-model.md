# Task 始终归属单一 Workspace

每个 Task、Task List 和 Task Tag 必须且只能属于一个 Workspace。“所有工作区”只是移除 Workspace 查询限制的聚合视图，不创建全局或无归属实体；跨 Workspace 创建或移动时必须明确选择目标。这一方案在提供全局总览的同时保留 Octane 既有的数据隔离、删除和备份边界，代价是所有工作区视图必须按 Workspace 区分同名清单与标签。
