import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import type { AsanaClientWrapper } from "./asana-client-wrapper.js";

async function readWorkspaceResource(
  client: AsanaClientWrapper,
  workspaceGid: string,
  uri: string,
): Promise<ReadResourceResult> {
  const { data: workspaces } = await client.listWorkspaces({
    opt_fields: "name,gid,resource_type,email_domains,is_organization",
  });

  const workspace = workspaces.find((ws: any) => ws.gid === workspaceGid);

  if (!workspace) {
    throw new Error(`Workspace not found: ${workspaceGid}`);
  }

  return {
    contents: [
      {
        uri,
        mimeType: "application/json",
        text: JSON.stringify(
          {
            name: workspace.name,
            id: workspace.gid,
            type: workspace.resource_type,
            is_organization: workspace.is_organization,
            email_domains: workspace.email_domains,
          },
          null,
          2,
        ),
      },
    ],
  };
}

async function readProjectResource(
  client: AsanaClientWrapper,
  projectGid: string,
  uri: string,
): Promise<ReadResourceResult> {
  const project = await client.getProject(projectGid, {
    opt_fields:
      "name,gid,resource_type,created_at,modified_at,archived,public,notes,color,default_view,due_date,due_on,start_on,workspace,team",
  });

  if (!project) {
    throw new Error(`Project not found: ${projectGid}`);
  }

  let sections: any[] = [];
  try {
    ({ data: sections } = await client.getProjectSections(projectGid, {
      opt_fields: "name,gid,created_at",
    }));
  } catch (sectionError) {
    console.error(
      `Error fetching sections for project ${projectGid}:`,
      sectionError,
    );
  }

  let customFields: any[] = [];
  try {
    const customFieldSettings = await client.getProjectCustomFieldSettings(
      projectGid,
      {
        opt_fields:
          "custom_field.name,custom_field.gid,custom_field.resource_type,custom_field.type,custom_field.description,custom_field.enum_options,custom_field.enum_options.gid,custom_field.enum_options.name,custom_field.enum_options.enabled,custom_field.precision,custom_field.format",
      },
    );
    if (customFieldSettings && Array.isArray(customFieldSettings)) {
      customFields = customFieldSettings
        .filter((setting: any) => setting?.custom_field)
        .map((setting: any) => {
          const field = setting.custom_field;
          const fieldData: any = {
            gid: field.gid ?? null,
            name: field.name ?? null,
            type: field.resource_type ?? null,
            field_type: field.type ?? null,
            description: field.description ?? null,
          };
          switch (field.type) {
            case "enum":
            case "multi_enum":
              if (field.enum_options && Array.isArray(field.enum_options)) {
                fieldData.enum_options = field.enum_options
                  .filter((o: any) => o.enabled !== false)
                  .map((o: any) => ({
                    gid: o.gid ?? null,
                    name: o.name ?? null,
                  }));
              }
              break;
            case "number":
              fieldData.precision = field.precision ?? 0;
              break;
          }
          return fieldData;
        });
    }
  } catch (customFieldError) {
    console.error(
      `Error fetching custom fields for project ${projectGid}:`,
      customFieldError,
    );
  }

  return {
    contents: [
      {
        uri,
        mimeType: "application/json",
        text: JSON.stringify(
          {
            name: project.name ?? null,
            id: project.gid ?? null,
            type: project.resource_type ?? null,
            created_at: project.created_at ?? null,
            modified_at: project.modified_at ?? null,
            archived: project.archived ?? false,
            public: project.public ?? false,
            notes: project.notes ?? null,
            color: project.color ?? null,
            default_view: project.default_view ?? null,
            due_date: project.due_date ?? null,
            due_on: project.due_on ?? null,
            start_on: project.start_on ?? null,
            workspace: project.workspace
              ? {
                  gid: project.workspace.gid ?? null,
                  name: project.workspace.name ?? null,
                }
              : null,
            team: project.team
              ? {
                  gid: project.team.gid ?? null,
                  name: project.team.name ?? null,
                }
              : null,
            sections: sections.map((s: any) => ({
              gid: s.gid ?? null,
              name: s.name ?? null,
              created_at: s.created_at ?? null,
            })),
            custom_fields: customFields,
          },
          null,
          2,
        ),
      },
    ],
  };
}

async function readTaskResource(
  client: AsanaClientWrapper,
  taskGid: string,
  uri: string,
): Promise<ReadResourceResult> {
  const task = await client.getTask(taskGid, {
    opt_fields:
      "name,gid,notes,completed,completed_at,created_at,modified_at,assignee,assignee.name,due_on,due_at,start_on,projects,projects.name,projects.gid,tags,tags.name,tags.gid,parent,parent.name,parent.gid,num_subtasks,custom_fields,custom_fields.name,custom_fields.gid,custom_fields.type,custom_fields.display_value,custom_fields.enum_value,custom_fields.enum_value.name,resource_type",
  });

  if (!task) {
    throw new Error(`Task not found: ${taskGid}`);
  }

  let subtasks: any[] = [];
  if ((task.num_subtasks ?? 0) > 0) {
    try {
      ({ data: subtasks } = await client.getSubtasksForTask(taskGid, {
        opt_fields: "name,gid,completed,assignee,assignee.name,due_on",
      }));
    } catch (subtaskError) {
      console.error(
        `Error fetching subtasks for task ${taskGid}:`,
        subtaskError,
      );
    }
  }

  let comments: any[] = [];
  try {
    const { data: stories } = await client.getStoriesForTask(taskGid, {
      opt_fields: "gid,type,text,created_at,created_by,created_by.name",
    });
    comments = stories.filter((s: any) => s.type === "comment").slice(0, 10);
  } catch (storyError) {
    console.error(`Error fetching stories for task ${taskGid}:`, storyError);
  }

  return {
    contents: [
      {
        uri,
        mimeType: "application/json",
        text: JSON.stringify(
          {
            name: task.name ?? null,
            gid: task.gid ?? null,
            type: task.resource_type ?? null,
            completed: task.completed ?? false,
            completed_at: task.completed_at ?? null,
            created_at: task.created_at ?? null,
            modified_at: task.modified_at ?? null,
            notes: task.notes ?? null,
            assignee: task.assignee
              ? {
                  gid: task.assignee.gid ?? null,
                  name: task.assignee.name ?? null,
                }
              : null,
            due_on: task.due_on ?? null,
            due_at: task.due_at ?? null,
            start_on: task.start_on ?? null,
            parent: task.parent
              ? { gid: task.parent.gid ?? null, name: task.parent.name ?? null }
              : null,
            projects: (task.projects ?? []).map((p: any) => ({
              gid: p.gid ?? null,
              name: p.name ?? null,
            })),
            tags: (task.tags ?? []).map((t: any) => ({
              gid: t.gid ?? null,
              name: t.name ?? null,
            })),
            custom_fields: (task.custom_fields ?? [])
              .filter((f: any) => f.display_value !== null)
              .map((f: any) => ({
                gid: f.gid ?? null,
                name: f.name ?? null,
                type: f.type ?? null,
                display_value: f.display_value ?? null,
              })),
            subtasks: subtasks.map((s: any) => ({
              gid: s.gid ?? null,
              name: s.name ?? null,
              completed: s.completed ?? false,
              assignee: s.assignee
                ? { gid: s.assignee.gid ?? null, name: s.assignee.name ?? null }
                : null,
              due_on: s.due_on ?? null,
            })),
            comments: comments.map((c: any) => ({
              gid: c.gid ?? null,
              text: c.text ?? null,
              created_at: c.created_at ?? null,
              created_by: c.created_by
                ? {
                    gid: c.created_by.gid ?? null,
                    name: c.created_by.name ?? null,
                  }
                : null,
            })),
          },
          null,
          2,
        ),
      },
    ],
  };
}

export async function registerResources(
  server: McpServer,
  client: AsanaClientWrapper,
): Promise<void> {
  // Register each workspace as a static resource (fetched once at startup)
  try {
    const { data: workspaces } = await client.listWorkspaces({
      opt_fields: "name,gid",
    });
    for (const ws of workspaces) {
      const uri = `asana://workspace/${ws.gid}`;
      server.registerResource(
        ws.name,
        uri,
        {
          mimeType: "application/json",
          description: `Asana workspace: ${ws.name}`,
        },
        async (resourceUri) => {
          console.error(
            "Received ReadResourceRequest:",
            resourceUri.toString(),
          );
          return readWorkspaceResource(client, ws.gid, resourceUri.toString());
        },
      );
    }
  } catch (error) {
    console.error("Error registering workspace resources at startup:", error);
  }

  // Register project template
  server.registerResource(
    "Asana Project",
    new ResourceTemplate("asana://project/{project_gid}", { list: undefined }),
    {
      mimeType: "application/json",
      description: "Get details for a specific Asana project by GID",
    },
    async (uri, variables) => {
      console.error("Received ReadResourceRequest:", uri.toString());
      const gid = Array.isArray(variables.project_gid)
        ? variables.project_gid[0]
        : variables.project_gid;
      return readProjectResource(client, gid, uri.toString());
    },
  );

  // Register task template
  server.registerResource(
    "Asana Task",
    new ResourceTemplate("asana://task/{task_gid}", { list: undefined }),
    {
      mimeType: "application/json",
      description: "Get details for a specific Asana task by GID",
    },
    async (uri, variables) => {
      console.error("Received ReadResourceRequest:", uri.toString());
      const gid = Array.isArray(variables.task_gid)
        ? variables.task_gid[0]
        : variables.task_gid;
      return readTaskResource(client, gid, uri.toString());
    },
  );
}
