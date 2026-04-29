"use client";

import { useCallback, useEffect, useState } from "react";

import {
  type AudioAsset,
  type KuralProject,
  createProject,
  deleteProject,
  loadAudioAssets,
  loadWorkspace,
  saveProject,
  setActiveProject as storeActiveProject,
} from "../lib/workspace";

export interface WorkspaceHandle {
  projects: KuralProject[];
  activeProjectId: string;
  assets: AudioAsset[];
  workspaceError: string;
  setProjects: React.Dispatch<React.SetStateAction<KuralProject[]>>;
  setAssets: React.Dispatch<React.SetStateAction<AudioAsset[]>>;
  setWorkspaceError: React.Dispatch<React.SetStateAction<string>>;
  setActiveProjectId: React.Dispatch<React.SetStateAction<string>>;
  refreshAssets: (projectId: string) => Promise<void>;
  refreshWorkspace: () => Promise<void>;
  persistProject: (project: KuralProject) => void;
  createNewProject: () => Promise<void>;
  removeActiveProject: (activeProject: KuralProject | null) => Promise<void>;
  switchProject: (projectId: string) => Promise<void>;
}

/**
 * Encapsulates the IndexedDB-backed workspace state machine: projects,
 * active project, audio assets. The `Home` component used to drive this
 * inline; consolidating it here keeps the page focused on render concerns
 * and makes the workspace exercises more testable in isolation.
 */
export function useWorkspace(): WorkspaceHandle {
  const [projects, setProjects] = useState<KuralProject[]>([]);
  const [activeProjectId, setActiveProjectId] = useState("");
  const [assets, setAssets] = useState<AudioAsset[]>([]);
  const [workspaceError, setWorkspaceError] = useState("");

  const refreshWorkspace = useCallback(async () => {
    try {
      const workspace = await loadWorkspace();
      setProjects(workspace.projects);
      setActiveProjectId(workspace.activeProjectId);
      setAssets(workspace.assets);
      setWorkspaceError("");
    } catch (exc) {
      setWorkspaceError(exc instanceof Error ? exc.message : "Could not load workspace");
    }
  }, []);

  const refreshAssets = useCallback(async (projectId: string) => {
    try {
      setAssets(await loadAudioAssets(projectId));
    } catch (exc) {
      setWorkspaceError(exc instanceof Error ? exc.message : "Could not load audio assets");
    }
  }, []);

  useEffect(() => {
    void refreshWorkspace();
  }, [refreshWorkspace]);

  const persistProject = useCallback((project: KuralProject) => {
    const next = { ...project, updatedAt: new Date().toISOString() };
    setProjects((current) =>
      current
        .map((candidate) => (candidate.id === next.id ? next : candidate))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    );
    void saveProject(next).catch((exc) => {
      setWorkspaceError(exc instanceof Error ? exc.message : "Could not save project");
    });
  }, []);

  const createNewProject = useCallback(async () => {
    const project = createProject(`Project ${projects.length + 1}`);
    await saveProject(project);
    setProjects((current) => [project, ...current]);
    setActiveProjectId(project.id);
    storeActiveProject(project.id);
    setAssets([]);
  }, [projects.length]);

  const removeActiveProject = useCallback(
    async (activeProject: KuralProject | null) => {
      if (!activeProject || projects.length <= 1) return;
      await deleteProject(activeProject.id);
      const next = projects.find((project) => project.id !== activeProject.id);
      if (next) {
        setActiveProjectId(next.id);
        storeActiveProject(next.id);
        setProjects((current) => current.filter((project) => project.id !== activeProject.id));
        await refreshAssets(next.id);
      }
    },
    [projects, refreshAssets]
  );

  const switchProject = useCallback(
    async (projectId: string) => {
      setActiveProjectId(projectId);
      storeActiveProject(projectId);
      await refreshAssets(projectId);
    },
    [refreshAssets]
  );

  return {
    projects,
    activeProjectId,
    assets,
    workspaceError,
    setProjects,
    setAssets,
    setWorkspaceError,
    setActiveProjectId,
    refreshAssets,
    refreshWorkspace,
    persistProject,
    createNewProject,
    removeActiveProject,
    switchProject,
  };
}
