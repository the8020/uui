Parent DOX: [uui/services DOX](../AGENTS.md).

# Purpose

- Serve the public login page and invoke package-owned login/logout behavior.

# Ownership

- Own the handler, manifest, login frontend, and service tests.

# Local Contracts

- Login offers enabled languages and Account default below the password.
  Selection immediately fetches the localized page and updates its text in
  place, preserving username/password; there is no Apply button. Explicit
  selection and successful POST write the system-scoped, HttpOnly presentation
  cookie with a one-year lifetime. Returning browsers preselect that language
  before JavaScript runs. Account default clears the cookie. Without a saved
  choice, login renders `defaultLoginLanguage`, then the system default; Account
  default still uses the account's language after authentication. Explicit
  service language headers remain supported. Existing sessions retain their
  language. Page messages use the UUI catalog and all inserted text is
  HTML-escaped.

- Page titles use the configured server title plus Sign in. Shared shell
  branding code supplies escaped Open Graph/Twitter metadata and public
  `/branding/favicon.png` and `/branding/social.jpg` responses, including custom
  database images. These routes expose only branding, never editing operations.

- The manifest keeps one Worker warm by default to avoid idle cold starts.
- Call the users package explicitly; passwords and authentication cookies never
  enter UUI boot data or messages.
- Read the HTML template per response and serve supported frontend assets
  through one constrained handler.
- The login page uses the fixed dark palette and does not read
  authenticated-shell theme state.

- The public login declaration explicitly selects
  `access.credential_namespace = "package:the8020/users"` so password
  verification uses the same credential namespace as users CBus programs and
  protected services.

# Work Guidance

# Verification

- From the repository root, run `deno task check` and `deno task test`.
- Login service tests cover the independent login default, saved choices, cookie
  lifetime/system scope, reset, disabled languages and rejected sign-ins.

# Child DOX Index

No child DOX documents. This document owns the entire local scope.
