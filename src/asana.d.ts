// Type definitions for Asana API v3
declare module "asana" {
  export class ApiClient {
    static instance: ApiClient;

    basePath: string;
    RETURN_COLLECTION: boolean;
    authentications: {
      token: {
        type: "personalAccessToken";
        accessToken?: string;
      };
    };
    defaultHeaders: Record<string, string>;
    timeout: number;
    cache: boolean;
    enableCookies: boolean;
    agent?: any;
    requestAgent: any | null;

    constructor();
    callApi(
      path: string,
      httpMethod: string,
      pathParams: object,
      queryParams: object,
      headerParams: object,
      formParams: object,
      bodyParam: any,
      authNames: string[],
      contentTypes: string[],
      accepts: string[],
      returnType: any,
    ): Promise<any>;
  }

  // --- Common opts (permissive to handle all Asana API variants) ---
  export interface Opts {
    opt_fields?: string;
    limit?: number;
    offset?: string;
    [key: string]: unknown;
  }

  // --- Shared reference type ---
  export interface AsanaRef {
    gid: string;
    name?: string;
    resource_type?: string;
  }

  // --- Pagination ---
  export interface NextPage {
    offset: string;
    path: string;
    uri: string;
  }
  /** Return type for all list/collection endpoints */
  export interface PagedResponse<T> {
    data: T[];
    next_page: NextPage | null;
  }

  // --- Domain base types ---

  export interface TaskBase {
    gid: string;
    name: string;
    completed: boolean;
    completed_at?: string | null;
    created_at: string;
    due_on?: string | null;
    due_at?: string | null;
    start_on?: string | null;
    modified_at: string;
    notes: string;
    resource_type: string;
    resource_subtype?: string;
    num_subtasks?: number;
    workspace?: AsanaRef;
    assignee?: AsanaRef | null;
    parent?: AsanaRef | null;
    projects?: AsanaRef[];
    tags?: AsanaRef[];
    followers?: AsanaRef[];
    memberships?: Array<{ project: AsanaRef; section?: AsanaRef }>;
    custom_fields?: Array<{
      gid: string;
      name: string;
      type: string;
      display_value?: string | null;
      enum_options?: Array<{ gid: string; name: string; enabled?: boolean }>;
      enum_value?: { gid: string; name: string } | null;
      number_value?: number | null;
      text_value?: string | null;
    }>;
  }

  export interface ProjectBase {
    gid: string;
    name: string;
    archived: boolean;
    color?: string | null;
    created_at: string;
    modified_at: string;
    notes: string;
    public: boolean;
    due_date?: string | null;
    due_on?: string | null;
    start_on?: string | null;
    default_view?: string;
    resource_type: string;
    workspace?: AsanaRef;
    team?: AsanaRef | null;
    owner?: AsanaRef | null;
    current_status?: {
      color: string;
      text: string;
      title?: string;
      author?: AsanaRef;
    } | null;
  }

  export interface WorkspaceBase {
    gid: string;
    name: string;
    resource_type?: string;
    email_domains?: string[];
    is_organization: boolean;
  }

  export interface UserBase {
    gid: string;
    name: string;
    resource_type: string;
    email?: string;
    photo?: {
      image_21x21?: string;
      image_27x27?: string;
      image_36x36?: string;
      image_60x60?: string;
      image_128x128?: string;
    } | null;
    workspaces?: AsanaRef[];
  }

  export interface TeamBase {
    gid: string;
    name: string;
    resource_type: string;
    description?: string;
    html_description?: string;
    organization?: AsanaRef;
    permalink_url?: string;
    visibility?: string;
  }

  export interface TaskCountsBase {
    num_tasks: number;
    num_completed_tasks: number;
    num_incomplete_tasks: number;
    num_milestones: number;
    num_completed_milestones: number;
    num_incomplete_milestones: number;
  }

  export interface StoryBase {
    gid: string;
    resource_type: string;
    type: string;
    text: string;
    html_text?: string;
    created_at: string;
    created_by?: AsanaRef;
  }

  export interface SectionBase {
    gid: string;
    resource_type: string;
    name: string;
    created_at?: string;
  }

  export interface TagBase {
    gid: string;
    resource_type: string;
    name: string;
    color?: string | null;
    notes?: string;
  }

  export interface PortfolioBase {
    gid: string;
    resource_type: string;
    name: string;
    color?: string | null;
    created_at?: string;
    owner?: AsanaRef | null;
  }

  export interface GoalBase {
    gid: string;
    resource_type: string;
    name: string;
    notes?: string;
    status?: string | null;
    time_period?: AsanaRef | null;
    workspace?: AsanaRef;
  }

  export interface TimePeriodBase {
    gid: string;
    resource_type: string;
    display_name: string;
    start_on: string;
    end_on: string;
    period: string;
    parent?: AsanaRef | null;
  }

  export interface TimeTrackingEntryBase {
    gid: string;
    resource_type: string;
    duration_minutes: number;
    entered_on: string;
    task?: AsanaRef;
    created_by?: AsanaRef;
  }

  export interface ProjectStatusBase {
    gid: string;
    resource_type: string;
    title?: string;
    text: string;
    color: string;
    html_text?: string;
    created_at?: string;
    author?: AsanaRef;
  }

  export interface CustomFieldSettingBase {
    gid: string;
    resource_type: string;
    custom_field?: {
      gid: string;
      name: string;
      type: string;
      resource_type: string;
      description?: string;
      precision?: number;
      format?: string;
      enum_options?: Array<{
        gid: string;
        name: string;
        enabled: boolean;
        color?: string;
      }>;
    };
    project?: AsanaRef;
  }

  // --- API Classes ---

  export class TasksApi {
    constructor(apiClient?: ApiClient);

    createTask(body: any, opts?: Opts): Promise<{ data: TaskBase }>;
    createSubtaskForTask(
      body: any,
      taskGid: string,
      opts?: Opts,
    ): Promise<{ data: TaskBase }>;
    deleteTask(taskGid: string): Promise<{ data: object }>;
    getTask(taskGid: string, opts?: Opts): Promise<{ data: TaskBase }>;
    getTasks(opts?: Opts): Promise<PagedResponse<TaskBase>>;
    getTasksForProject(
      projectGid: string,
      opts?: Opts,
    ): Promise<PagedResponse<TaskBase>>;
    getTasksForSection(
      sectionGid: string,
      opts?: Opts,
    ): Promise<PagedResponse<TaskBase>>;
    getTasksForTag(tagGid: string, opts?: Opts): Promise<PagedResponse<TaskBase>>;
    getSubtasksForTask(
      taskGid: string,
      opts?: Opts,
    ): Promise<PagedResponse<TaskBase>>;
    searchTasksForWorkspace(
      workspaceGid: string,
      opts?: Opts,
    ): Promise<PagedResponse<TaskBase>>;
    updateTask(
      body: any,
      taskGid: string,
      opts?: Opts,
    ): Promise<{ data: TaskBase }>;
    setParentForTask(
      body: any,
      taskGid: string,
      opts?: Opts,
    ): Promise<{ data: TaskBase }>;
    addDependenciesForTask(
      body: any,
      taskGid: string,
    ): Promise<{ data: object }>;
    addDependentsForTask(body: any, taskGid: string): Promise<{ data: object }>;
    removeDependenciesForTask(
      body: any,
      taskGid: string,
    ): Promise<{ data: object }>;
    addTagForTask(body: any, taskGid: string): Promise<{ data: object }>;
    removeTagForTask(body: any, taskGid: string): Promise<{ data: object }>;
    addProjectForTask(body: any, taskGid: string): Promise<{ data: object }>;
    removeProjectForTask(body: any, taskGid: string): Promise<{ data: object }>;
  }

  export class ProjectsApi {
    constructor(apiClient?: ApiClient);

    createProject(body: any, opts?: Opts): Promise<{ data: ProjectBase }>;
    getProject(projectGid: string, opts?: Opts): Promise<{ data: ProjectBase }>;
    updateProject(
      body: any,
      projectGid: string,
      opts?: Opts,
    ): Promise<{ data: ProjectBase }>;
    deleteProject(projectGid: string): Promise<{ data: object }>;
    getProjects(opts?: Opts): Promise<PagedResponse<ProjectBase>>;
    getProjectsForWorkspace(
      workspaceGid: string,
      opts?: Opts,
    ): Promise<PagedResponse<ProjectBase>>;
    getTaskCountsForProject(
      projectGid: string,
      opts?: Opts,
    ): Promise<{ data: TaskCountsBase }>;
  }

  export class WorkspacesApi {
    constructor(apiClient?: ApiClient);

    getWorkspace(
      workspaceGid: string,
      opts?: Opts,
    ): Promise<{ data: WorkspaceBase }>;
    getWorkspaces(opts?: Opts): Promise<PagedResponse<WorkspaceBase>>;
    updateWorkspace(
      body: any,
      workspaceGid: string,
      opts?: Opts,
    ): Promise<{ data: WorkspaceBase }>;
  }

  export class StoriesApi {
    constructor(apiClient?: ApiClient);

    getStoriesForTask(
      taskGid: string,
      opts?: Opts,
    ): Promise<PagedResponse<StoryBase>>;
    createStoryForTask(
      body: any,
      taskGid: string,
      opts?: Opts,
    ): Promise<{ data: StoryBase }>;
    deleteStory(storyGid: string): Promise<{ data: object }>;
    getStory(storyGid: string, opts?: Opts): Promise<{ data: StoryBase }>;
    updateStory(
      body: any,
      storyGid: string,
      opts?: Opts,
    ): Promise<{ data: StoryBase }>;
  }

  export class ProjectStatusesApi {
    constructor(apiClient?: ApiClient);

    getProjectStatus(
      projectStatusGid: string,
      opts?: Opts,
    ): Promise<{ data: ProjectStatusBase }>;
    getProjectStatusesForProject(
      projectGid: string,
      opts?: Opts,
    ): Promise<PagedResponse<ProjectStatusBase>>;
    createProjectStatusForProject(
      body: any,
      projectGid: string,
      opts?: Opts,
    ): Promise<{ data: ProjectStatusBase }>;
    deleteProjectStatus(projectStatusGid: string): Promise<{ data: object }>;
  }

  export class TagsApi {
    constructor(apiClient?: ApiClient);

    getTag(tagGid: string, opts?: Opts): Promise<{ data: TagBase }>;
    getTagsForWorkspace(
      workspaceGid: string,
      opts?: Opts,
    ): Promise<PagedResponse<TagBase>>;
    getTagsForTask(tagGid: string, opts?: Opts): Promise<PagedResponse<TagBase>>;
    createTagForWorkspace(
      body: any,
      workspaceGid: string,
      opts?: Opts,
    ): Promise<{ data: TagBase }>;
    updateTag(
      body: any,
      tagGid: string,
      opts?: Opts,
    ): Promise<{ data: TagBase }>;
    deleteTag(tagGid: string): Promise<{ data: object }>;
  }

  export class CustomFieldSettingsApi {
    constructor(apiClient?: ApiClient);

    getCustomFieldSettingsForProject(
      projectGid: string,
      opts?: Opts,
    ): Promise<PagedResponse<CustomFieldSettingBase>>;
  }

  // Note: SectionsApi write methods use a non-standard calling convention —
  // the request body is passed as `opts.body` rather than as the first argument.
  export class SectionsApi {
    constructor(apiClient?: ApiClient);

    getSection(sectionGid: string, opts?: Opts): Promise<{ data: SectionBase }>;
    getSectionsForProject(
      projectGid: string,
      opts?: Opts,
    ): Promise<PagedResponse<SectionBase>>;
    createSectionForProject(
      projectGid: string,
      opts?: { body?: { data: any }; opt_fields?: string },
    ): Promise<{ data: SectionBase }>;
    updateSection(
      sectionGid: string,
      opts?: { body?: { data: any }; opt_fields?: string },
    ): Promise<{ data: SectionBase }>;
    deleteSection(sectionGid: string): Promise<{ data: object }>;
    insertSectionForProject(
      projectGid: string,
      opts?: { body?: { data: any } },
    ): Promise<{ data: object }>;
    addTaskForSection(
      sectionGid: string,
      opts?: { body?: { data: any } },
    ): Promise<{ data: object }>;
  }

  export class PortfoliosApi {
    constructor(apiClient?: ApiClient);

    getPortfolio(
      portfolioGid: string,
      opts?: Opts,
    ): Promise<{ data: PortfolioBase }>;
    getPortfolios(
      workspaceGid: string,
      opts?: Opts,
    ): Promise<PagedResponse<PortfolioBase>>;
    createPortfolio(body: any, opts?: Opts): Promise<{ data: PortfolioBase }>;
    updatePortfolio(
      body: any,
      portfolioGid: string,
      opts?: Opts,
    ): Promise<{ data: PortfolioBase }>;
    deletePortfolio(portfolioGid: string): Promise<{ data: object }>;
    getItemsForPortfolio(
      portfolioGid: string,
      opts?: Opts,
    ): Promise<PagedResponse<ProjectBase>>;
    addItemForPortfolio(
      body: any,
      portfolioGid: string,
    ): Promise<{ data: object }>;
    removeItemForPortfolio(
      body: any,
      portfolioGid: string,
    ): Promise<{ data: object }>;
  }

  export class GoalsApi {
    constructor(apiClient?: ApiClient);

    getGoal(goalGid: string, opts?: Opts): Promise<{ data: GoalBase }>;
    getGoals(opts?: Opts): Promise<PagedResponse<GoalBase>>;
    createGoal(body: any, opts?: Opts): Promise<{ data: GoalBase }>;
    updateGoal(
      body: any,
      goalGid: string,
      opts?: Opts,
    ): Promise<{ data: GoalBase }>;
    deleteGoal(goalGid: string): Promise<{ data: object }>;
  }

  export class TimePeriodsApi {
    constructor(apiClient?: ApiClient);

    getTimePeriods(
      workspaceGid: string,
      opts?: Opts,
    ): Promise<PagedResponse<TimePeriodBase>>;
    getTimePeriod(
      timePeriodGid: string,
      opts?: Opts,
    ): Promise<{ data: TimePeriodBase }>;
  }

  export class TimeTrackingEntriesApi {
    constructor(apiClient?: ApiClient);

    getTimeTrackingEntriesForTask(
      taskGid: string,
      opts?: Opts,
    ): Promise<PagedResponse<TimeTrackingEntryBase>>;
    createTimeTrackingEntry(
      body: any,
      taskGid: string,
      opts?: Opts,
    ): Promise<{ data: TimeTrackingEntryBase }>;
    getTimeTrackingEntry(
      timeTrackingEntryGid: string,
      opts?: Opts,
    ): Promise<{ data: TimeTrackingEntryBase }>;
    updateTimeTrackingEntry(
      body: any,
      timeTrackingEntryGid: string,
      opts?: Opts,
    ): Promise<{ data: TimeTrackingEntryBase }>;
    deleteTimeTrackingEntry(
      timeTrackingEntryGid: string,
    ): Promise<{ data: object }>;
  }

  export interface AttachmentBase {
    gid: string;
    resource_type: string;
    name?: string;
    resource_subtype?: string;
    created_at?: string;
    download_url?: string | null;
    host?: string;
    parent?: AsanaRef;
    permalink_url?: string;
    size?: number;
    view_url?: string | null;
  }

  export interface EnumOption {
    gid: string;
    resource_type: string;
    name: string;
    enabled: boolean;
    color?: string | null;
  }

  export interface CustomFieldBase {
    gid: string;
    resource_type: string;
    name: string;
    type: string;
    description?: string;
    enabled?: boolean;
    created_by?: AsanaRef;
    currency_code?: string | null;
    custom_label?: string | null;
    custom_label_position?: string;
    date_value?: { date?: string; date_time?: string } | null;
    display_value?: string | null;
    enum_options?: EnumOption[];
    enum_value?: EnumOption | null;
    format?: string;
    has_notifications_enabled?: boolean;
    is_formula_field?: boolean;
    is_global_to_workspace?: boolean;
    is_value_read_only?: boolean;
    multi_enum_values?: EnumOption[];
    number_value?: number | null;
    people_value?: AsanaRef[];
    precision?: number;
    text_value?: string | null;
    workspace?: AsanaRef;
  }

  export class AttachmentsApi {
    getAttachmentsForObject(
      parent: string,
      opts?: Opts,
    ): Promise<PagedResponse<AttachmentBase>>;
    getAttachment(
      attachment_gid: string,
      opts?: Opts,
    ): Promise<{ data: AttachmentBase }>;
    deleteAttachment(attachment_gid: string): Promise<{ data: object }>;
    createAttachmentForObject(opts?: Opts & {
      parent?: string;
      resource_subtype?: string;
      url?: string;
      name?: string;
    }): Promise<{ data: AttachmentBase }>;
  }

  export class CustomFieldsApi {
    getCustomFieldsForWorkspace(
      workspace_gid: string,
      opts?: Opts,
    ): Promise<PagedResponse<CustomFieldBase>>;
    getCustomField(
      custom_field_gid: string,
      opts?: Opts,
    ): Promise<{ data: CustomFieldBase }>;
    createCustomField(body: any, opts?: Opts): Promise<{ data: CustomFieldBase }>;
    updateCustomField(
      custom_field_gid: string,
      opts?: Opts & { body?: any },
    ): Promise<{ data: CustomFieldBase }>;
    deleteCustomField(custom_field_gid: string): Promise<{ data: object }>;
    createEnumOptionForCustomField(
      custom_field_gid: string,
      opts?: Opts & { body?: any },
    ): Promise<{ data: EnumOption }>;
    updateEnumOption(
      enum_option_gid: string,
      opts?: Opts & { body?: any },
    ): Promise<{ data: EnumOption }>;
  }

  export class UsersApi {
    getUser(user_gid: string, opts?: Opts): Promise<{ data: UserBase }>;
    getUsersForWorkspace(
      workspace_gid: string,
      opts?: Opts,
    ): Promise<PagedResponse<UserBase>>;
  }

  export class TeamsApi {
    getTeam(team_gid: string, opts?: Opts): Promise<{ data: TeamBase }>;
    getTeamsForWorkspace(
      workspace_gid: string,
      opts?: Opts,
    ): Promise<PagedResponse<TeamBase>>;
    getTeamsForUser(
      user_gid: string,
      organization: string,
      opts?: Opts,
    ): Promise<PagedResponse<TeamBase>>;
  }

  /** Compact resource returned by typeahead — always has gid + name; email included for user results */
  export interface AsanaNamedResource {
    gid: string;
    name: string;
    resource_type?: string;
    email?: string;
  }

  export class TypeaheadApi {
    typeaheadForWorkspace(
      workspace_gid: string,
      resource_type: string,
      opts?: {
        query?: string;
        count?: number;
        opt_fields?: string;
      },
    ): Promise<{ data: AsanaNamedResource[] }>;
  }

  // Export remaining APIs (not yet typed — used via any in the SDK internals)
  export {
    AllocationsApi,
    AuditLogAPIApi,
    BatchAPIApi,
    EventsApi,
    GoalRelationshipsApi,
    JobsApi,
    MembershipsApi,
    OrganizationExportsApi,
    PortfolioMembershipsApi,
    ProjectBriefsApi,
    ProjectMembershipsApi,
    ProjectTemplatesApi,
    RulesApi,
    StatusUpdatesApi,
    TaskTemplatesApi,
    TeamMembershipsApi,
    UserTaskListsApi,
    WebhooksApi,
    WorkspaceMembershipsApi,
  } from "./api/index";
}
