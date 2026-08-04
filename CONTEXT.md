# Octane

Octane organizes saved web resources and their supporting context inside user-defined workspaces.

## Language

**Workspace**:
A top-level collection that owns categories and workspace-scoped resources.
_Avoid_: Space, group

**Category**:
The single organizational container a bookmark belongs to within a workspace.
_Avoid_: Folder, Tag

**Bookmark**:
A saved web resource that belongs to exactly one workspace and one category.
_Avoid_: Browser tab, pinned tab

**Tag**:
A reusable label attached to a bookmark; unlike a category, a bookmark may have multiple Tags. It is separate from a Task Tag even when both have the same name.
_Avoid_: Task Tag, Label, browser tab, 标签

**Browser tab**:
A web page currently open in a browser window, shown as “标签页” in the UI.
_Avoid_: Tag, bookmark

**Pinned tab**:
A workspace-scoped saved reference to a web page that appears in the persistent tab area.
_Avoid_: Tag, bookmark

**Context**:
A note attached to a bookmark that may be stored as plaintext or encrypted content.
_Avoid_: Description, Tag

**Task**:
An actionable item that belongs to exactly one Workspace, regardless of which view presents it.
_Avoid_: Global task, unscoped task

**All-workspaces view**:
An aggregate view that presents Tasks from every Workspace without changing their Workspace ownership.
_Avoid_: Global workspace, global task list

**Task List**:
A Workspace-scoped organizational container to which a Task may optionally belong; a Task belongs to at most one Task List.
_Avoid_: Checklist, Folder, Inbox

**Inbox**:
A view of Tasks that do not belong to a Task List. In the All-workspaces view, it aggregates unlisted Tasks from every Workspace.
_Avoid_: Default Task List, system Task List

**Archived Task List**:
A restorable Task List hidden from active navigation whose Tasks are excluded from active aggregate views without being completed or deleted.
_Avoid_: Deleted Task List, completed Task List

**Checklist Item**:
A lightweight, ordered step contained within a Task whose completion state is independent from its parent Task. It is not independently scheduled, organized, tagged, or shown in aggregate views.
_Avoid_: Subtask, Task, Task List item

**Completed Task**:
A Task explicitly marked complete while retaining its ownership, organization, Due Date, and Checklist Item states. It may be reopened even when some Checklist Items remain incomplete.
_Avoid_: Archived Task, canceled Task, deleted Task

**Deleted Task**:
A recoverable Task removed from normal views and retained in Trash until the user restores or permanently deletes it.
_Avoid_: Archived Task, completed Task, permanently deleted Task

**Trash**:
A view of Deleted Tasks that preserves their Workspace ownership and supports restoration or explicit permanent deletion.
_Avoid_: Archive, Completed Tasks

**Task Tag**:
A managed Workspace-scoped label with its own identity, color, and order that may be attached to multiple Tasks. It remains independent of bookmark Tags even when names match.
_Avoid_: Bookmark Tag, Task List, Category

**Priority**:
A Task classification with high, medium, low, and none states; none is the default state.
_Avoid_: Completion status

**Due Date**:
The calendar date by which a Task is intended to be completed; it is neither a start date nor a notification time.
_Avoid_: Schedule Date, Reminder, Due Time

**Today view**:
An active aggregate view of incomplete Tasks whose Due Date is today or overdue.
_Avoid_: Daily Task List, My Day

**Next 7 Days view**:
An active aggregate view of incomplete Tasks due from today through the following six calendar days, excluding overdue Tasks.
_Avoid_: Recent 7 Days, Last 7 Days
