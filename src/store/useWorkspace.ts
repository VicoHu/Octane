import { create } from 'zustand';
import type { Workspace, Category } from '@/shared/types';
import * as WorkspaceService from '@/services/WorkspaceService';
import * as CategoryService from '@/services/CategoryService';

interface WorkspaceState {
  workspaces: Workspace[];
  currentWorkspaceId: string | null;
  categories: Category[];
  currentCategoryId: string | null;
  loading: boolean;

  loadWorkspaces: () => Promise<void>;
  createWorkspace: (name: string, icon: string) => Promise<void>;
  updateWorkspace: (id: string, updates: Partial<Pick<Workspace, 'name' | 'icon' | 'order'>>) => Promise<void>;
  deleteWorkspace: (id: string) => Promise<void>;
  selectWorkspace: (id: string) => Promise<void>;

  loadCategories: () => Promise<void>;
  createCategory: (name: string, icon: string) => Promise<void>;
  updateCategory: (id: string, updates: Partial<Pick<Category, 'name' | 'icon' | 'order'>>) => Promise<void>;
  deleteCategory: (id: string) => Promise<void>;
  selectCategory: (id: string) => void;
}

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  workspaces: [],
  currentWorkspaceId: null,
  categories: [],
  currentCategoryId: null,
  loading: false,

  loadWorkspaces: async () => {
    set({ loading: true });
    const workspaces = await WorkspaceService.listWorkspaces();
    const currentWorkspaceId = workspaces[0]?.id ?? null;
    set({ workspaces, currentWorkspaceId, loading: false });

    if (currentWorkspaceId) {
      const categories = await CategoryService.listCategories(currentWorkspaceId);
      const currentCategoryId = categories[0]?.id ?? null;
      set({ categories, currentCategoryId });
    } else {
      set({ categories: [], currentCategoryId: null });
    }
  },

  createWorkspace: async (name, icon) => {
    const workspace = await WorkspaceService.createWorkspace(name, icon);
    set((s) => ({ workspaces: [...s.workspaces, workspace] }));
    if (!get().currentWorkspaceId) {
      await get().selectWorkspace(workspace.id);
    }
  },

  updateWorkspace: async (id, updates) => {
    await WorkspaceService.updateWorkspace(id, updates);
    set((s) => ({
      workspaces: s.workspaces.map((w) => (w.id === id ? { ...w, ...updates } : w)),
    }));
  },

  deleteWorkspace: async (id) => {
    await WorkspaceService.deleteWorkspace(id);
    const workspaces = await WorkspaceService.listWorkspaces();
    const currentWorkspaceId = get().currentWorkspaceId === id
      ? workspaces[0]?.id ?? null
      : get().currentWorkspaceId;
    set({ workspaces, currentWorkspaceId });
    if (currentWorkspaceId) {
      await get().loadCategories();
    }
  },

  selectWorkspace: async (id) => {
    set({ currentWorkspaceId: id, currentCategoryId: null });
    const categories = await CategoryService.listCategories(id);
    const currentCategoryId = categories[0]?.id ?? null;
    set({ categories, currentCategoryId });
  },

  loadCategories: async () => {
    const workspaceId = get().currentWorkspaceId;
    if (!workspaceId) return;
    const categories = await CategoryService.listCategories(workspaceId);
    set({ categories });
  },

  createCategory: async (name, icon) => {
    const workspaceId = get().currentWorkspaceId;
    if (!workspaceId) return;
    const category = await CategoryService.createCategory(workspaceId, name, icon);
    set((s) => ({ categories: [...s.categories, category] }));
  },

  updateCategory: async (id, updates) => {
    await CategoryService.updateCategory(id, updates);
    set((s) => ({
      categories: s.categories.map((c) => (c.id === id ? { ...c, ...updates } : c)),
    }));
  },

  deleteCategory: async (id) => {
    await CategoryService.deleteCategory(id);
    const categories = get().categories.filter((c) => c.id !== id);
    const currentCategoryId = get().currentCategoryId === id
      ? categories[0]?.id ?? null
      : get().currentCategoryId;
    set({ categories, currentCategoryId });
  },

  selectCategory: (id) => {
    set({ currentCategoryId: id });
  },
}));
