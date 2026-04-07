import { useEffect, useState } from "react";
import panoptesService from "../services/panoptes";
import { UserInfo } from "../services/interfaces";
import { config } from "../config";

export default function Login() {
  const [authUser, setAuthUser] = useState<UserInfo | null>(null);
  const oauthEnabled =
    config.oauthClientId && config.oauthClientSecret && config.oauthRedirectUri;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthCode = params.get("code");
    const env = params.get("env") || config.environment;

    if (oauthCode && oauthEnabled) {
      // Strip code and redirect back to root with remaining params
      params.delete("code");
      const cleanSearch = params.toString();
      const cleanUrl = "/" + (cleanSearch ? "?" + cleanSearch : "");
      console.log(cleanUrl);
      window.history.replaceState({}, "", cleanUrl);

      handleOAuthCallback(oauthCode, env).then(() => initialize(env));
      return;
    } else if (oauthEnabled) {
      initialize(env);
    }
  }, []);

  const handleOAuthCallback = async (code: string, env: string) => {
    try {
      await panoptesService.exchangeCodeForToken(code);
      const user = await panoptesService.getAuthenticatedUser(env);
      console.log(user);
      setAuthUser(user?.login || user?.display_name || "authenticated");
    } catch (err: any) {
      console.error("OAuth callback failed:", err.message);
    }
  };

  const handleSignOut = () => {
    panoptesService.signOut();
    setAuthUser(null);
  };

  const initialize = async (env: any) => {
    console.log("initializing");
    if (!panoptesService.isAuthenticated()) {
      console.log("not authenticated");

      if (panoptesService.loadStoredToken()) {
        console.log("loaded stored token");
        try {
          const user = await panoptesService.getAuthenticatedUser(env);
          console.log(user);
          setAuthUser(user?.login || user?.display_name || "authenticated");
        } catch (err: any) {
          console.warn("Stored token invalid, clearing:", err.message);
          panoptesService.signOut();
        }
      }
    }

    if (!panoptesService.isAuthenticated()) {
      const username = import.meta.env.VITE_PANOPTES_USERNAME;
      const password = import.meta.env.VITE_PANOPTES_PASSWORD;
      if (username && password) {
        try {
          const { user } = await panoptesService.signIn(username, password);
          setAuthUser(user?.login || username);
        } catch (authErr: any) {
          console.warn(
            "Auto-auth failed, continuing as anonymous:",
            authErr.message,
          );
        }
      }
    }
  };

  return (
    <nav className="header-nav">
      {authUser ? (
        <button onClick={handleSignOut} className="tab-button">
          Sign out ({authUser.display_name})
        </button>
      ) : oauthEnabled ? (
        <a
          href={panoptesService.getOAuthLoginUrl()}
          className="oauth-login-button"
        >
          Log in with Zooniverse
        </a>
      ) : null}
    </nav>
  );
}
