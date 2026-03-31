/**
 * governance/paths.ts — Standard directory layout for governance artifacts.
 */
import * as path from "path";

export interface GovernancePaths {
  root: string;
  snapshots: string;
  reports: string;
  tasks: string;
  history: string;
  mermaid: string;
}

export function getGovernancePaths(projectRoot: string): GovernancePaths {
  const root = path.join(projectRoot, ".drive", "governance");
  return {
    root,
    snapshots: path.join(root, "snapshots"),
    reports: path.join(root, "reports"),
    tasks: path.join(root, "tasks"),
    history: path.join(root, "history"),
    mermaid: path.join(root, "mermaid"),
  };
}

export async function ensureGovernanceDirs(projectRoot: string): Promise<GovernancePaths> {
  const paths = getGovernancePaths(projectRoot);
  const { mkdir } = await import("fs/promises");
  for (const dir of Object.values(paths)) {
    await mkdir(dir, { recursive: true });
  }
  return paths;
}
