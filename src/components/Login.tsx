import { useEffect, useState } from "react";
import panoptesService from "../services/panoptes";
import { UserInfo } from "../services/interfaces";
import { config } from "../config";

export default function Login({ children }: { children: React.ReactElement }) {
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
      window.history.replaceState({}, "", cleanUrl);

      handleOAuthCallback(oauthCode, env);
      return;
    } else if (oauthEnabled) {
      if (panoptesService.loadStoredToken()) {
        panoptesService
          .getAuthenticatedUser(env)
          .then((user) => (user ? setAuthUser(user) : null));
      }
    }
  }, []);

  const handleOAuthCallback = async (code: string, env: string) => {
    console.log("do callback");
    try {
      panoptesService
        .exchangeCodeForToken(code)
        .then(() => panoptesService.getAuthenticatedUser(env))
        .then((user) => (user ? setAuthUser(user) : null));
    } catch (err: any) {
      console.error("OAuth callback failed:", err.message);
      panoptesService.signOut();
    }
  };

  const handleSignOut = () => {
    panoptesService.signOut();
    setAuthUser(null);
  };

  if (authUser) {
    return (
      <>
        <nav className="header-nav">
          <button onClick={handleSignOut} className="tab-button">
            Sign out ({authUser.display_name})
          </button>
        </nav>
        {children}
      </>
    );
  } else {
    return (
      <div className="sign-in-container">
        You need to be logged in to use this app!
        <a
          href={panoptesService.getOAuthLoginUrl()}
          className="oauth-login-button"
        >
          Log in with Zooniverse
        </a>
      </div>
    );
  }
}
