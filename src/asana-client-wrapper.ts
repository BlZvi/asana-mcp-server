import Asana from "asana";

// Standard opts accepted by most Asana list/get endpoints
type WrapperOpts = { opt_fields?: string; limit?: number; offset?: string };

/** Pagination cursor returned by Asana list endpoints */
export type NextPage = { offset: string; path: string; uri: string } | null;
/** Wrapper return type for all list methods — includes data array and pagination cursor */
export type Paginated<T> = { data: T[]; next_page: NextPage };

export class AsanaClientWrapper {
  private workspaces: Asana.WorkspacesApi;
  private projects: Asana.ProjectsApi;
  private tasks: Asana.TasksApi;
  private stories: Asana.StoriesApi;
  private projectStatuses: Asana.ProjectStatusesApi;
  private tags: Asana.TagsApi;
  private customFieldSettings: Asana.CustomFieldSettingsApi;
  private sections: Asana.SectionsApi;
  private portfolios: Asana.PortfoliosApi;
  private goals: Asana.GoalsApi;
  private timePeriods: Asana.TimePeriodsApi;
  private timeTrackingEntries: Asana.TimeTrackingEntriesApi;
  private users: Asana.UsersApi;
  private teams: Asana.TeamsApi;
  private attachments: Asana.AttachmentsApi;
  private customFields: Asana.CustomFieldsApi;
  private typeahead: Asana.TypeaheadApi;

  constructor(token: string) {
    const client = Asana.ApiClient.instance;
    client.authentications.token.accessToken = token;

    // Initialize API instances
    this.workspaces = new Asana.WorkspacesApi();
    this.projects = new Asana.ProjectsApi();
    this.tasks = new Asana.TasksApi();
    this.stories = new Asana.StoriesApi();
    this.projectStatuses = new Asana.ProjectStatusesApi();
    this.tags = new Asana.TagsApi();
    this.customFieldSettings = new Asana.CustomFieldSettingsApi();
    this.sections = new Asana.SectionsApi();
    this.portfolios = new Asana.PortfoliosApi();
    this.goals = new Asana.GoalsApi();
    this.timePeriods = new Asana.TimePeriodsApi();
    this.timeTrackingEntries = new Asana.TimeTrackingEntriesApi();
    this.users = new Asana.UsersApi();
    this.teams = new Asana.TeamsApi();
    this.attachments = new Asana.AttachmentsApi();
    this.customFields = new Asana.CustomFieldsApi();
    this.typeahead = new Asana.TypeaheadApi();
  }

  async listWorkspaces(
    opts: WrapperOpts = {},
  ): Promise<Paginated<Asana.WorkspaceBase>> {
    const response = await this.workspaces.getWorkspaces(opts);
    return { data: response.data, next_page: response.next_page ?? null };
  }

  async searchProjects(
    workspace: string,
    namePattern: string,
    archived: boolean = false,
    opts: WrapperOpts = {},
  ): Promise<Asana.ProjectBase[]> {
    const pattern = new RegExp(namePattern, "i");
    const allProjects: Asana.ProjectBase[] = [];
    let offset: string | undefined;

    do {
      const params: Asana.Opts = { archived, limit: 100, ...opts };
      if (offset) params.offset = offset;
      const response = await this.projects.getProjectsForWorkspace(
        workspace,
        params,
      );
      allProjects.push(...response.data);
      offset = response.next_page?.offset;
    } while (offset);

    return allProjects.filter((project) => pattern.test(project.name));
  }

  async searchTasks(workspace: string, searchOpts: any = {}): Promise<Paginated<any>> {
    // Extract known parameters
    const {
      text,
      resource_subtype,
      completed,
      is_subtask,
      has_attachment,
      is_blocked,
      is_blocking,
      sort_by,
      sort_ascending,
      opt_fields,
      ...otherOpts
    } = searchOpts;

    // Build search parameters
    const searchParams: any = {
      ...otherOpts, // Include any additional filter parameters
    };

    // Map underscore parameter names to dot-notation for Asana API
    // (e.g., sections_all -> sections.all)
    const keyMappings: { [key: string]: string } = {
      portfolios_any: "portfolios.any",
      assignee_any: "assignee.any",
      assignee_not: "assignee.not",
      projects_any: "projects.any",
      projects_not: "projects.not",
      projects_all: "projects.all",
      sections_any: "sections.any",
      sections_not: "sections.not",
      sections_all: "sections.all",
      tags_any: "tags.any",
      tags_not: "tags.not",
      tags_all: "tags.all",
      teams_any: "teams.any",
      followers_any: "followers.any",
      followers_not: "followers.not",
      created_by_any: "created_by.any",
      created_by_not: "created_by.not",
      assigned_by_any: "assigned_by.any",
      assigned_by_not: "assigned_by.not",
      liked_by_not: "liked_by.not",
      commented_on_by_not: "commented_on_by.not",
      due_on_before: "due_on.before",
      due_on_after: "due_on.after",
      due_at_before: "due_at.before",
      due_at_after: "due_at.after",
      start_on_before: "start_on.before",
      start_on_after: "start_on.after",
      created_on_before: "created_on.before",
      created_on_after: "created_on.after",
      created_at_before: "created_at.before",
      created_at_after: "created_at.after",
      completed_on_before: "completed_on.before",
      completed_on_after: "completed_on.after",
      completed_at_before: "completed_at.before",
      completed_at_after: "completed_at.after",
      modified_on_before: "modified_on.before",
      modified_on_after: "modified_on.after",
      modified_at_before: "modified_at.before",
      modified_at_after: "modified_at.after",
    };

    for (const [underscoreKey, dotKey] of Object.entries(keyMappings)) {
      if (searchParams[underscoreKey] !== undefined) {
        searchParams[dotKey] = searchParams[underscoreKey];
        delete searchParams[underscoreKey];
      }
    }

    // Handle custom fields if provided
    if (searchOpts.custom_fields) {
      if (typeof searchOpts.custom_fields === "string") {
        try {
          searchOpts.custom_fields = JSON.parse(searchOpts.custom_fields);
        } catch (err) {
          if (err instanceof Error) {
            err.message = `custom_fields must be a JSON object : ${err.message}`;
          }
          throw err;
        }
      }
      Object.entries(searchOpts.custom_fields).forEach(([key, value]) => {
        searchParams[`custom_fields.${key}`] = value;
      });
      delete searchParams.custom_fields; // Remove the custom_fields object since we've processed it
    }

    // Add optional parameters if provided
    if (text) searchParams.text = text;
    if (resource_subtype) searchParams.resource_subtype = resource_subtype;
    if (completed !== undefined) searchParams.completed = completed;
    if (is_subtask !== undefined) searchParams.is_subtask = is_subtask;
    if (has_attachment !== undefined)
      searchParams.has_attachment = has_attachment;
    if (is_blocked !== undefined) searchParams.is_blocked = is_blocked;
    if (is_blocking !== undefined) searchParams.is_blocking = is_blocking;
    if (sort_by) searchParams.sort_by = sort_by;
    if (sort_ascending !== undefined)
      searchParams.sort_ascending = sort_ascending;
    if (opt_fields) searchParams.opt_fields = opt_fields;

    const response = await this.tasks.searchTasksForWorkspace(
      workspace,
      searchParams,
    );

    // Transform the response to simplify custom fields if present
    const transformedData = response.data.map((task: Asana.TaskBase) => {
      if (!task.custom_fields) return task;

      return {
        ...task,
        custom_fields: task.custom_fields.reduce(
          (acc: Record<string, string | null>, field) => {
            const key = `${field.name} (${field.gid})`;
            let value = field.display_value ?? null;

            // For enum fields with a value, include the enum option GID
            if (field.type === "enum" && field.enum_value) {
              value = `${field.display_value} (${field.enum_value.gid})`;
            }

            acc[key] = value;
            return acc;
          },
          {},
        ),
      };
    });

    return { data: transformedData, next_page: response.next_page ?? null };
  }

  async getTask(
    taskId: string,
    opts: WrapperOpts = {},
  ): Promise<Asana.TaskBase> {
    const response = await this.tasks.getTask(taskId, opts);
    return response.data;
  }

  async createTask(projectId: string, data: any): Promise<Asana.TaskBase> {
    // Extract memberships if provided
    const { memberships, projects: dataProjects, ...restData } = data;

    // Build task data
    const taskPayload: any = {
      ...restData,
      // Handle resource_subtype if provided
      resource_subtype: data.resource_subtype || "default_task",
      // Handle custom_fields if provided
      custom_fields: data.custom_fields || {},
    };

    // If memberships are provided, use them (allows section placement)
    if (memberships && Array.isArray(memberships) && memberships.length > 0) {
      // Ensure projectId is included in memberships
      const hasProjectId = memberships.some(
        (m: any) => m.project === projectId,
      );
      if (!hasProjectId) {
        taskPayload.memberships = [{ project: projectId }, ...memberships];
      } else {
        taskPayload.memberships = memberships;
      }
    } else {
      // Fall back to projects array
      const projects = dataProjects || [];
      if (!projects.includes(projectId)) {
        projects.push(projectId);
      }
      taskPayload.projects = projects;
    }

    const taskData = { data: taskPayload };
    const response = await this.tasks.createTask(taskData);
    return response.data;
  }

  async getStoriesForTask(
    taskId: string,
    opts: WrapperOpts = {},
  ): Promise<Paginated<Asana.StoryBase>> {
    const response = await this.stories.getStoriesForTask(taskId, opts);
    return { data: response.data, next_page: response.next_page ?? null };
  }

  async updateTask(taskId: string, data: any): Promise<Asana.TaskBase> {
    const body = {
      data: {
        ...data,
        // Handle resource_subtype if provided
        resource_subtype: data.resource_subtype || undefined,
        // Handle custom_fields if provided
        custom_fields: data.custom_fields || undefined,
      },
    };
    const opts = {};
    const response = await this.tasks.updateTask(body, taskId, opts);
    return response.data;
  }

  async getProject(
    projectId: string,
    opts: WrapperOpts = {},
  ): Promise<Asana.ProjectBase> {
    // Only include opts if opt_fields was actually provided
    const options = opts.opt_fields ? opts : {};
    const response = await this.projects.getProject(projectId, options);
    return response.data;
  }

  async getProjectCustomFieldSettings(
    projectId: string,
    opts: WrapperOpts = {},
  ): Promise<Asana.CustomFieldSettingBase[]> {
    try {
      const options: WrapperOpts = {
        limit: 100,
        opt_fields:
          opts.opt_fields ||
          "custom_field,custom_field.name,custom_field.gid,custom_field.resource_type,custom_field.type,custom_field.description,custom_field.enum_options,custom_field.enum_options.name,custom_field.enum_options.gid,custom_field.enum_options.enabled",
      };

      const response =
        await this.customFieldSettings.getCustomFieldSettingsForProject(
          projectId,
          options,
        );
      return response.data;
    } catch (error) {
      console.error(
        `Error fetching custom field settings for project ${projectId}:`,
        error,
      );
      return [];
    }
  }

  async getProjectTaskCounts(
    projectId: string,
    opts: WrapperOpts = {},
  ): Promise<Asana.TaskCountsBase> {
    // Only include opts if opt_fields was actually provided
    const options = opts.opt_fields ? opts : {};
    const response = await this.projects.getTaskCountsForProject(
      projectId,
      options,
    );
    return response.data;
  }

  async getProjectSections(
    projectId: string,
    opts: WrapperOpts = {},
  ): Promise<Paginated<Asana.SectionBase>> {
    const options = opts.opt_fields ? opts : {};
    const response = await this.sections.getSectionsForProject(
      projectId,
      options,
    );
    return { data: response.data, next_page: response.next_page ?? null };
  }

  async getSection(
    sectionGid: string,
    opts: WrapperOpts = {},
  ): Promise<Asana.SectionBase> {
    const options = opts.opt_fields ? opts : {};
    const response = await this.sections.getSection(sectionGid, options);
    return response.data;
  }

  async createSection(
    projectGid: string,
    data: any,
    opts: WrapperOpts = {},
  ): Promise<Asana.SectionBase> {
    const options: { body?: { data: any }; opt_fields?: string } = {
      body: { data },
    };
    if (opts.opt_fields) options.opt_fields = opts.opt_fields;
    const response = await this.sections.createSectionForProject(
      projectGid,
      options,
    );
    return response.data;
  }

  async updateSection(
    sectionGid: string,
    data: any,
    opts: WrapperOpts = {},
  ): Promise<Asana.SectionBase> {
    const options: { body?: { data: any }; opt_fields?: string } = {
      body: { data },
    };
    if (opts.opt_fields) options.opt_fields = opts.opt_fields;
    const response = await this.sections.updateSection(sectionGid, options);
    return response.data;
  }

  async deleteSection(sectionGid: string): Promise<object> {
    const response = await this.sections.deleteSection(sectionGid);
    return response.data;
  }

  async moveSection(projectGid: string, data: any): Promise<object> {
    const response = await this.sections.insertSectionForProject(projectGid, {
      body: { data },
    });
    return response.data;
  }

  async addTaskToSection(sectionGid: string, data: any): Promise<object> {
    const response = await this.sections.addTaskForSection(sectionGid, {
      body: { data },
    });
    return response.data;
  }

  async createProject(
    data: any,
    opts: WrapperOpts = {},
  ): Promise<Asana.ProjectBase> {
    const options = opts.opt_fields ? opts : {};
    const body = { data };
    const response = await this.projects.createProject(body, options);
    return response.data;
  }

  async createTaskStory(
    taskId: string,
    text: string | null = null,
    opts: WrapperOpts = {},
    html_text: string | null = null,
  ): Promise<Asana.StoryBase> {
    const options = opts.opt_fields ? opts : {};
    const data: any = {};

    if (text) {
      data.text = text;
    } else if (html_text) {
      data.html_text = html_text;
    } else {
      throw new Error("Either text or html_text must be provided");
    }

    const body = { data };
    const response = await this.stories.createStoryForTask(
      body,
      taskId,
      options,
    );
    return response.data;
  }

  async addTaskDependencies(
    taskId: string,
    dependencies: string[],
  ): Promise<object> {
    const body = {
      data: {
        dependencies: dependencies,
      },
    };
    const response = await this.tasks.addDependenciesForTask(body, taskId);
    return response.data;
  }

  async addTaskDependents(
    taskId: string,
    dependents: string[],
  ): Promise<object> {
    const body = {
      data: {
        dependents: dependents,
      },
    };
    const response = await this.tasks.addDependentsForTask(body, taskId);
    return response.data;
  }

  async createSubtask(
    parentTaskId: string,
    data: any,
    opts: WrapperOpts = {},
  ): Promise<Asana.TaskBase> {
    const taskData = {
      data: {
        ...data,
      },
    };
    const response = await this.tasks.createSubtaskForTask(
      taskData,
      parentTaskId,
      opts,
    );
    return response.data;
  }

  async setParentForTask(
    data: any,
    taskId: string,
    opts: WrapperOpts = {},
  ): Promise<Asana.TaskBase> {
    const response = await this.tasks.setParentForTask({ data }, taskId, opts);
    return response.data;
  }

  async getProjectStatus(
    statusId: string,
    opts: WrapperOpts = {},
  ): Promise<Asana.ProjectStatusBase> {
    const response = await this.projectStatuses.getProjectStatus(
      statusId,
      opts,
    );
    return response.data;
  }

  async getProjectStatusesForProject(
    projectId: string,
    opts: WrapperOpts = {},
  ): Promise<Paginated<Asana.ProjectStatusBase>> {
    const response = await this.projectStatuses.getProjectStatusesForProject(
      projectId,
      opts,
    );
    return { data: response.data, next_page: response.next_page ?? null };
  }

  async createProjectStatus(
    projectId: string,
    data: any,
  ): Promise<Asana.ProjectStatusBase> {
    const body = { data };
    const response = await this.projectStatuses.createProjectStatusForProject(
      body,
      projectId,
    );
    return response.data;
  }

  async deleteProjectStatus(statusId: string): Promise<object> {
    const response = await this.projectStatuses.deleteProjectStatus(statusId);
    return response.data;
  }

  async getMultipleTasksByGid(
    taskIds: string[],
    opts: WrapperOpts = {},
  ): Promise<Asana.TaskBase[]> {
    if (taskIds.length > 25) {
      throw new Error("Maximum of 25 task IDs allowed");
    }

    // Use Promise.all to fetch tasks in parallel
    const tasks = await Promise.all(
      taskIds.map((taskId) => this.getTask(taskId, opts)),
    );

    return tasks;
  }

  async getTasksForTag(
    tag_gid: string,
    opts: WrapperOpts = {},
  ): Promise<Paginated<Asana.TaskBase>> {
    const response = await this.tasks.getTasksForTag(tag_gid, opts);
    return { data: response.data, next_page: response.next_page ?? null };
  }

  async getTagsForWorkspace(
    workspace_gid: string,
    opts: WrapperOpts = {},
  ): Promise<Paginated<Asana.TagBase>> {
    const response = await this.tags.getTagsForWorkspace(workspace_gid, opts);
    return { data: response.data, next_page: response.next_page ?? null };
  }

  async getTag(
    tag_gid: string,
    opts: WrapperOpts = {},
  ): Promise<Asana.TagBase> {
    const response = await this.tags.getTag(tag_gid, opts);
    return response.data;
  }

  async getTagsForTask(
    task_gid: string,
    opts: WrapperOpts = {},
  ): Promise<Paginated<Asana.TagBase>> {
    const response = await this.tags.getTagsForTask(task_gid, opts);
    return { data: response.data, next_page: response.next_page ?? null };
  }

  async updateTag(
    tag_gid: string,
    data: any,
    opts: WrapperOpts = {},
  ): Promise<Asana.TagBase> {
    const body = { data };
    const response = await this.tags.updateTag(body, tag_gid, opts);
    return response.data;
  }

  async deleteTag(tag_gid: string): Promise<object> {
    const response = await this.tags.deleteTag(tag_gid);
    return response.data;
  }

  async createTagForWorkspace(
    workspace_gid: string,
    data: any,
    opts: WrapperOpts = {},
  ): Promise<Asana.TagBase> {
    const body = { data };
    const response = await this.tags.createTagForWorkspace(
      body,
      workspace_gid,
      opts,
    );
    return response.data;
  }

  async addTagToTask(task_gid: string, tag_gid: string): Promise<object> {
    const body = {
      data: {
        tag: tag_gid,
      },
    };
    const response = await this.tasks.addTagForTask(body, task_gid);
    return response.data;
  }

  async removeTagFromTask(task_gid: string, tag_gid: string): Promise<object> {
    const body = {
      data: {
        tag: tag_gid,
      },
    };
    const response = await this.tasks.removeTagForTask(body, task_gid);
    return response.data;
  }

  async addProjectToTask(
    taskId: string,
    projectId: string,
    data: any = {},
  ): Promise<object> {
    const body: any = {
      data: {
        project: projectId,
      },
    };

    // Add optional positioning parameters if provided
    if (data.section) {
      body.data.section = data.section;
    }
    if (data.insert_after) {
      body.data.insert_after = data.insert_after;
    }
    if (data.insert_before) {
      body.data.insert_before = data.insert_before;
    }

    const response = await this.tasks.addProjectForTask(body, taskId);
    return response.data;
  }

  async removeProjectFromTask(
    taskId: string,
    projectId: string,
  ): Promise<object> {
    const body = {
      data: {
        project: projectId,
      },
    };
    const response = await this.tasks.removeProjectForTask(body, taskId);
    return response.data;
  }

  async deleteTask(taskId: string): Promise<object> {
    const response = await this.tasks.deleteTask(taskId);
    return response.data;
  }

  async getSubtasksForTask(
    taskGid: string,
    opts: WrapperOpts = {},
  ): Promise<Paginated<Asana.TaskBase>> {
    const response = await this.tasks.getSubtasksForTask(taskGid, opts);
    return { data: response.data, next_page: response.next_page ?? null };
  }

  async getTasksForProject(
    projectGid: string,
    opts: WrapperOpts = {},
  ): Promise<Paginated<Asana.TaskBase>> {
    const response = await this.tasks.getTasksForProject(projectGid, opts);
    return { data: response.data, next_page: response.next_page ?? null };
  }

  async getTasksForSection(
    sectionGid: string,
    opts: WrapperOpts = {},
  ): Promise<Paginated<Asana.TaskBase>> {
    const response = await this.tasks.getTasksForSection(sectionGid, opts);
    return { data: response.data, next_page: response.next_page ?? null };
  }

  async updateProject(
    projectGid: string,
    data: any,
    opts: WrapperOpts = {},
  ): Promise<Asana.ProjectBase> {
    const options = opts.opt_fields ? opts : {};
    const body = { data };
    const response = await this.projects.updateProject(
      body,
      projectGid,
      options,
    );
    return response.data;
  }

  async deleteProject(projectGid: string): Promise<object> {
    const response = await this.projects.deleteProject(projectGid);
    return response.data;
  }

  async getPortfolio(
    portfolioGid: string,
    opts: WrapperOpts = {},
  ): Promise<Asana.PortfolioBase> {
    const response = await this.portfolios.getPortfolio(portfolioGid, opts);
    return response.data;
  }

  async getPortfolios(
    workspaceGid: string,
    opts: WrapperOpts = {},
  ): Promise<Paginated<Asana.PortfolioBase>> {
    const response = await this.portfolios.getPortfolios(workspaceGid, opts);
    return { data: response.data, next_page: response.next_page ?? null };
  }

  async createPortfolio(
    data: any,
    opts: WrapperOpts = {},
  ): Promise<Asana.PortfolioBase> {
    const options = opts.opt_fields ? opts : {};
    const body = { data };
    const response = await this.portfolios.createPortfolio(body, options);
    return response.data;
  }

  async updatePortfolio(
    portfolioGid: string,
    data: any,
    opts: WrapperOpts = {},
  ): Promise<Asana.PortfolioBase> {
    const options = opts.opt_fields ? opts : {};
    const body = { data };
    const response = await this.portfolios.updatePortfolio(
      body,
      portfolioGid,
      options,
    );
    return response.data;
  }

  async deletePortfolio(portfolioGid: string): Promise<object> {
    const response = await this.portfolios.deletePortfolio(portfolioGid);
    return response.data;
  }

  async getPortfolioItems(
    portfolioGid: string,
    opts: WrapperOpts = {},
  ): Promise<Paginated<Asana.ProjectBase>> {
    const response = await this.portfolios.getItemsForPortfolio(
      portfolioGid,
      opts,
    );
    return { data: response.data, next_page: response.next_page ?? null };
  }

  async addPortfolioItem(portfolioGid: string, data: any): Promise<object> {
    const body = { data };
    const response = await this.portfolios.addItemForPortfolio(
      body,
      portfolioGid,
    );
    return response.data;
  }

  async removePortfolioItem(portfolioGid: string, data: any): Promise<object> {
    const body = { data };
    const response = await this.portfolios.removeItemForPortfolio(
      body,
      portfolioGid,
    );
    return response.data;
  }

  async getGoal(
    goalGid: string,
    opts: WrapperOpts = {},
  ): Promise<Asana.GoalBase> {
    const response = await this.goals.getGoal(goalGid, opts);
    return response.data;
  }

  async getGoals(
    workspaceGid: string,
    opts: WrapperOpts = {},
  ): Promise<Paginated<Asana.GoalBase>> {
    const response = await this.goals.getGoals({
      workspace: workspaceGid,
      ...opts,
    });
    return { data: response.data, next_page: response.next_page ?? null };
  }

  async createGoal(data: any, opts: WrapperOpts = {}): Promise<Asana.GoalBase> {
    const options = opts.opt_fields ? opts : {};
    const body = { data };
    const response = await this.goals.createGoal(body, options);
    return response.data;
  }

  async updateGoal(
    goalGid: string,
    data: any,
    opts: WrapperOpts = {},
  ): Promise<Asana.GoalBase> {
    const options = opts.opt_fields ? opts : {};
    const body = { data };
    const response = await this.goals.updateGoal(body, goalGid, options);
    return response.data;
  }

  async deleteGoal(goalGid: string): Promise<object> {
    const response = await this.goals.deleteGoal(goalGid);
    return response.data;
  }

  async getTimePeriods(
    workspaceGid: string,
    opts: WrapperOpts = {},
  ): Promise<Paginated<Asana.TimePeriodBase>> {
    const response = await this.timePeriods.getTimePeriods(workspaceGid, opts);
    return { data: response.data, next_page: response.next_page ?? null };
  }

  async getTimePeriod(
    timePeriodGid: string,
    opts: WrapperOpts = {},
  ): Promise<Asana.TimePeriodBase> {
    const response = await this.timePeriods.getTimePeriod(timePeriodGid, opts);
    return response.data;
  }

  async getTimeTrackingEntriesForTask(
    taskGid: string,
    opts: WrapperOpts = {},
  ): Promise<Paginated<Asana.TimeTrackingEntryBase>> {
    const response =
      await this.timeTrackingEntries.getTimeTrackingEntriesForTask(
        taskGid,
        opts,
      );
    return { data: response.data, next_page: response.next_page ?? null };
  }

  async createTimeTrackingEntry(
    taskGid: string,
    data: any,
    opts: WrapperOpts = {},
  ): Promise<Asana.TimeTrackingEntryBase> {
    const options = opts.opt_fields ? opts : {};
    const body = { data };
    const response = await this.timeTrackingEntries.createTimeTrackingEntry(
      body,
      taskGid,
      options,
    );
    return response.data;
  }

  async getTimeTrackingEntry(
    timeTrackingEntryGid: string,
    opts: WrapperOpts = {},
  ): Promise<Asana.TimeTrackingEntryBase> {
    const response = await this.timeTrackingEntries.getTimeTrackingEntry(
      timeTrackingEntryGid,
      opts,
    );
    return response.data;
  }

  async updateTimeTrackingEntry(
    timeTrackingEntryGid: string,
    data: any,
    opts: WrapperOpts = {},
  ): Promise<Asana.TimeTrackingEntryBase> {
    const options = opts.opt_fields ? opts : {};
    const body = { data };
    const response = await this.timeTrackingEntries.updateTimeTrackingEntry(
      body,
      timeTrackingEntryGid,
      options,
    );
    return response.data;
  }

  async deleteTimeTrackingEntry(timeTrackingEntryGid: string): Promise<object> {
    const response =
      await this.timeTrackingEntries.deleteTimeTrackingEntry(
        timeTrackingEntryGid,
      );
    return response.data;
  }

  async getUser(
    userGid: string,
    opts: WrapperOpts = {},
  ): Promise<Asana.UserBase> {
    const response = await this.users.getUser(userGid, opts);
    return response.data;
  }

  async getUsersForWorkspace(
    workspaceGid: string,
    opts: WrapperOpts = {},
  ): Promise<Paginated<Asana.UserBase>> {
    const response = await this.users.getUsersForWorkspace(workspaceGid, opts);
    return { data: response.data, next_page: response.next_page ?? null };
  }

  async getTeam(
    teamGid: string,
    opts: WrapperOpts = {},
  ): Promise<Asana.TeamBase> {
    const response = await this.teams.getTeam(teamGid, opts);
    return response.data;
  }

  async getTeamsForWorkspace(
    workspaceGid: string,
    opts: WrapperOpts = {},
  ): Promise<Paginated<Asana.TeamBase>> {
    const response = await this.teams.getTeamsForWorkspace(workspaceGid, opts);
    return { data: response.data, next_page: response.next_page ?? null };
  }

  async getAttachmentsForObject(
    parentGid: string,
    opts: WrapperOpts = {},
  ): Promise<Paginated<Asana.AttachmentBase>> {
    const response = await this.attachments.getAttachmentsForObject(
      parentGid,
      opts,
    );
    return { data: response.data, next_page: response.next_page ?? null };
  }

  async getAttachment(
    attachmentGid: string,
    opts: WrapperOpts = {},
  ): Promise<Asana.AttachmentBase> {
    const response = await this.attachments.getAttachment(attachmentGid, opts);
    return response.data;
  }

  async deleteAttachment(attachmentGid: string): Promise<object> {
    const response = await this.attachments.deleteAttachment(attachmentGid);
    return response.data;
  }

  async createAttachmentForObject(
    parentGid: string,
    data: { resource_subtype: string; url?: string; name?: string },
    opts: WrapperOpts = {},
  ): Promise<Asana.AttachmentBase> {
    const response = await this.attachments.createAttachmentForObject({
      parent: parentGid,
      ...data,
      ...opts,
    });
    return response.data;
  }

  async getCustomFieldsForWorkspace(
    workspaceGid: string,
    opts: WrapperOpts = {},
  ): Promise<Paginated<Asana.CustomFieldBase>> {
    const response = await this.customFields.getCustomFieldsForWorkspace(
      workspaceGid,
      opts,
    );
    return { data: response.data, next_page: response.next_page ?? null };
  }

  async getCustomField(
    customFieldGid: string,
    opts: WrapperOpts = {},
  ): Promise<Asana.CustomFieldBase> {
    const response = await this.customFields.getCustomField(
      customFieldGid,
      opts,
    );
    return response.data;
  }

  async createCustomField(
    data: any,
    opts: WrapperOpts = {},
  ): Promise<Asana.CustomFieldBase> {
    const body = { data };
    const response = await this.customFields.createCustomField(body, opts);
    return response.data;
  }

  async updateCustomField(
    customFieldGid: string,
    data: any,
    opts: WrapperOpts = {},
  ): Promise<Asana.CustomFieldBase> {
    const options: { body?: { data: any }; opt_fields?: string } = {
      body: { data },
    };
    if (opts.opt_fields) options.opt_fields = opts.opt_fields;
    const response = await this.customFields.updateCustomField(
      customFieldGid,
      options,
    );
    return response.data;
  }

  async deleteCustomField(customFieldGid: string): Promise<object> {
    const response = await this.customFields.deleteCustomField(customFieldGid);
    return response.data;
  }

  async createEnumOption(
    customFieldGid: string,
    data: any,
    opts: WrapperOpts = {},
  ): Promise<Asana.EnumOption> {
    const options: { body?: { data: any }; opt_fields?: string } = {
      body: { data },
    };
    if (opts.opt_fields) options.opt_fields = opts.opt_fields;
    const response = await this.customFields.createEnumOptionForCustomField(
      customFieldGid,
      options,
    );
    return response.data;
  }

  async updateEnumOption(
    enumOptionGid: string,
    data: any,
    opts: WrapperOpts = {},
  ): Promise<Asana.EnumOption> {
    const options: { body?: { data: any }; opt_fields?: string } = {
      body: { data },
    };
    if (opts.opt_fields) options.opt_fields = opts.opt_fields;
    const response = await this.customFields.updateEnumOption(
      enumOptionGid,
      options,
    );
    return response.data;
  }

  async typeaheadForWorkspace(
    workspace: string,
    resourceType: string,
    opts: { query?: string; count?: number; opt_fields?: string } = {},
  ): Promise<Asana.AsanaNamedResource[]> {
    const response = await this.typeahead.typeaheadForWorkspace(
      workspace,
      resourceType,
      opts,
    );
    return response.data;
  }
}
