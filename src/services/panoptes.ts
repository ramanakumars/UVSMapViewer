import axios from "axios";
import { config } from "../config";

const API_URLS: Record<string, string> = {
  production: "https://panoptes.zooniverse.org/api",
  staging: "https://panoptes-staging.zooniverse.org/api",
};

const OAUTH_URLS: Record<string, string> = {
  production: "https://www.zooniverse.org",
  staging: "https://panoptes-staging.zooniverse.org",
};

const JSONAPI_HEADERS = {
  Accept: "application/vnd.api+json; version=1",
  "Content-Type": "application/json",
};

const TOKEN_KEY = "zooniverse_ife_oauth_token";

let bearerToken: string | null = null;
let tokenExpiry = 0;

interface Token {
  token: string;
  expiry: number;
}

export const panoptesService = {
  // ── Data endpoints ────────────────────────────────────────────────

  async getProject(projectId: number, environment = "production") {
    const url = API_URLS[environment] || API_URLS.production;
    const res = await axios.get(`${url}/projects/${projectId}`, {
      headers: JSONAPI_HEADERS,
    });
    return res.data.projects[0];
  },

  async getWorkflow(workflowId: number, environment = "production") {
    const url = API_URLS[environment] || API_URLS.production;
    const res = await axios.get(`${url}/workflows/${workflowId}`, {
      headers: JSONAPI_HEADERS,
    });
    return res.data.workflows[0];
  },

  async getActiveWorkflow(projectId: number, environment = "production") {
    const project = await this.getProject(projectId, environment);
    const ids = project.links?.active_workflows || [];
    if (ids.length === 0)
      throw new Error(`Project ${projectId} has no active workflows`);
    return this.getWorkflow(ids[0], environment);
  },

  async getSubjectSets(workflowId: number, environment = "production") {
    const url = API_URLS[environment] || API_URLS.production;
    const workflow = await this.getWorkflow(workflowId, environment);
    const ids = workflow.links?.subject_sets || [];
    if (ids.length === 0) return [];
    const res = await axios.get(`${url}/subject_sets`, {
      headers: JSONAPI_HEADERS,
      params: { id: ids.join(",") },
    });
    return res.data.subject_sets || [];
  },

  async getSubjects(
    workflowId: number,
    environment = "production",
    pageSize = 10,
  ) {
    const url = API_URLS[environment] || API_URLS.production;

    try {
      const res = await axios.get(`${url}/subjects/queued`, {
        headers: this.getAuthHeaders(),
        params: {
          workflow_id: workflowId,
          page_size: pageSize,
          http_cache: true,
        },
      });
      if (res.data.subjects?.length > 0) return res.data.subjects;
    } catch {
      // queued endpoint may require auth; fall back to subject sets
    }

    const workflow = await this.getWorkflow(workflowId, environment);
    const ids = workflow.links?.subject_sets || [];
    if (ids.length === 0)
      throw new Error(`Workflow ${workflowId} has no linked subject sets`);
    const res = await axios.get(`${url}/subjects`, {
      headers: JSONAPI_HEADERS,
      params: { subject_set_id: ids[0], page_size: pageSize, http_cache: true },
    });
    return res.data.subjects || [];
  },

  async createClassification(
    classificationData: any,
    environment = "production",
  ) {
    const url = API_URLS[environment] || API_URLS.production;
    const res = await axios.post(
      `${url}/classifications`,
      { classifications: classificationData },
      { headers: this.getAuthHeaders() },
    );
    return res.data;
  },

  async getAuthenticatedUser(environment = "production") {
    const url = API_URLS[environment] || API_URLS.production;
    console.log(this.getAuthHeaders());
    const res = await axios.get(`${url}/me`, {
      headers: this.getAuthHeaders(),
    });
    return res.data.users?.[0] || null;
  },

  // ── Password auth (uses Vite proxy for CORS/CSRF) ────────────────

  async signIn(login: string, password: string) {
    console.log("signing in");
    const proxy = "/zooniverse";
    const h = {
      Accept: "application/json",
      "Content-Type": "application/json",
    };

    const csrf = await axios.get(`${proxy}/users/sign_in/?now=${Date.now()}`, {
      headers: h,
      withCredentials: true,
    });

    const signIn = await axios.post(
      `${proxy}/users/sign_in`,
      { user: { login, password, remember_me: true } },
      {
        headers: { ...h, "X-CSRF-Token": csrf.headers["x-csrf-token"] },
        withCredentials: true,
      },
    );

    const token = await axios.post(
      `${proxy}/oauth/token`,
      {
        grant_type: "password",
        client_id:
          "f79cf5ea821bb161d8cbb52d061ab9a2321d7cb169007003af66b43f7b79ce2a",
      },
      { headers: h, withCredentials: true },
    );

    bearerToken = token.data.access_token;
    tokenExpiry = Date.now() + token.data.expires_in * 1000 - 60000;

    return { user: signIn.data, token: bearerToken };
  },

  // ── OAuth authorization code flow ────────────────────────────────

  getOAuthLoginUrl() {
    const base = OAUTH_URLS[config.environment] || OAUTH_URLS.production;
    const params = new URLSearchParams({
      response_type: "code",
      client_id: config.oauthClientId,
      redirect_uri: config.oauthRedirectUri,
      scope: "user project classification subject",
    });
    return `${base}/oauth/authorize?${params}`;
  },

  async exchangeCodeForToken(code: string) {
    // Token exchange goes through the Vite proxy (/zooniverse → www.zooniverse.org)
    // because the /oauth/token endpoint doesn't support CORS.
    const res = await axios.post("/zooniverse/oauth/token", {
      grant_type: "authorization_code",
      client_id: config.oauthClientId,
      client_secret: config.oauthClientSecret,
      redirect_uri: config.oauthRedirectUri,
      code,
    });

    console.log(res.data);
    this.setToken(res.data.access_token, res.data.expires_in);
    return res.data;
  },

  // ── Token management ─────────────────────────────────────────────

  setToken(token: string, expiresIn: number) {
    bearerToken = token;
    tokenExpiry = Date.now() + expiresIn * 1000 - 60000;
    localStorage.setItem(
      TOKEN_KEY,
      JSON.stringify({ token: bearerToken, expiry: tokenExpiry }),
    );
  },

  loadStoredToken() {
    try {
      let storage_data = localStorage.getItem(TOKEN_KEY);
      const stored: Token | null = storage_data
        ? JSON.parse(storage_data)
        : null;
      if (stored?.token && stored.expiry > Date.now()) {
        bearerToken = stored.token;
        tokenExpiry = stored.expiry;
        return true;
      }
    } catch {
      // corrupt entry
    }
    localStorage.removeItem(TOKEN_KEY);
    return false;
  },

  isAuthenticated() {
    return bearerToken && Date.now() < tokenExpiry;
  },

  getAuthHeaders() {
    if (!this.isAuthenticated()) return JSONAPI_HEADERS;
    return { ...JSONAPI_HEADERS, Authorization: `Bearer ${bearerToken}` };
  },

  signOut() {
    console.log("Signing out");
    bearerToken = null;
    tokenExpiry = 0;
    localStorage.removeItem(TOKEN_KEY);
  },
};

export default panoptesService;
