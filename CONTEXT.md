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
A reusable label attached to a bookmark; unlike a category, a bookmark may have multiple Tags.
_Avoid_: Label, browser tab, 标签

**Browser tab**:
A web page currently open in a browser window, shown as “标签页” in the UI.
_Avoid_: Tag, bookmark

**Pinned tab**:
A workspace-scoped saved reference to a web page that appears in the persistent tab area.
_Avoid_: Tag, bookmark

**Context**:
A note attached to a bookmark that may be stored as plaintext or encrypted content.
_Avoid_: Description, Tag
