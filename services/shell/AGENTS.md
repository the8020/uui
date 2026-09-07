Parent DOX: [uui/services DOX](../AGENTS.md).

# Purpose

- Serve and build the authenticated UUI browser shell.

# Ownership

- Own the handler, manifest, `build.sh`, and service tests; the frontend child
  owns authored browser source.
- The `.generated/` bundle and source map are build outputs from
  frontend/main.ts. Build minified JavaScript with an external source map.

# Local Contracts

- `assets.ts` owns constrained browser asset delivery: content versions, ETags,
  304 responses, and a 32 MiB/128-entry cache of source bytes. Native file
  metadata invalidates changed bytes; individual assets are at most 16 MiB.
- Return ordinary asset bodies without `Content-Encoding` or local encoding
  negotiation. The Deno supervisor's native HTTP listener owns automatic
  compression after Worker transfer; keep this coordinated with the generic
  runtime instead of adding another asset compressor or encoded cache.
- `/package-assets/<namespace>/<repository>/<path>` exposes only regular files
  beneath the installed package's explicit `public/` root, with real-path
  confinement. No component-specific routes or registry exist.
- Version shell script and stylesheet URLs by their SHA-256 contents. Immutable
  caching requires a matching query version or content hash in the filename;
  unversioned assets revalidate. Weak source ETags and `Vary: Accept-Encoding`
  stay consistent across encoded responses, HEAD, and 304. HEAD omits a length
  because the supervisor selects the GET encoding. HTML remains authenticated
  and `no-store`.
- Build from this repository's deno.json and keep runtime browser imports on the
  browser-safe protocol surface.
- Theme preferences stay in browser storage and initialize before first paint.

# Work Guidance

- Keep shared presentation and asset hosting generic while providing packages
  own optional browser components. Reuse the existing bounded asset path and
  lifecycle contract; unrelated functionality must not become a shell-bundle
  dependency.

- Edit authored frontend modules and rebuild through `services/shell/build.sh`
  when browser source changes.

# Verification

- Run `deno task check` and `deno task test` from the UUI root.
- `deno task test:asset-delivery` starts the actual shell Worker and supervisor
  HTTP listener plus a disposable Go relay using the real supervisor client. It
  checks byte-exact gzip/Brotli/identity responses, Brotli-only requests,
  versioned caching, 304, HEAD, stale versions, and compressed no-store HTML. It
  uses the sibling kernel source and Go on PATH; `--go=/path/to/go` selects an
  explicit toolchain. Asset unit tests also cover the package-public path.
- Use the existing connection, presentation, lists, programs, and download
  browser tasks for affected browser behavior.

# Child DOX Index

- [frontend/AGENTS.md](frontend/AGENTS.md): Implement browser presentation,
  forms, lists, messages, downloads, and custom elements.
