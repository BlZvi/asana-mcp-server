export const isReadOnlyMode = process.env.ASANA_READ_ONLY_MODE === "true";
export const defaultWorkspaceGid = process.env.ASANA_DEFAULT_WORKSPACE_GID;

export function resolveWorkspace(workspace: string | undefined): string {
  const resolved = workspace ?? defaultWorkspaceGid;
  if (!resolved)
    throw new Error(
      "workspace is required — pass it explicitly or set the ASANA_DEFAULT_WORKSPACE_GID environment variable",
    );
  return resolved;
}
