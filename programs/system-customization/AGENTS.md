Parent DOX: [UUI programs](../AGENTS.md).

# Purpose

- Edit the system-wide server title, favicon, and social preview from
  Administration.

# Ownership

- Own the ordinary UUI program and its lazily built image-picker browser module.
- Root `branding.ts` owns storage and authorization; the shell owns image
  serving and default files. `src/branding_images.ts` shares output dimensions
  and limits.

# Local Contracts

- Require `the8020.uui.branding.edit` to open and save. Save commits the title
  and selected image overrides together; Back discards drafts. Per-field default
  actions change the draft until Save.
- Default title is `80|20`. Defaults use the shell's yellow `80` square PNG and
  `80|20` JPEG social image; only custom images are stored in the database.
- Reuse `fileUpload` and its binary Channel. Filenames alone enter Models;
  pending converted images and previews remain outside snapshots.
- Browser conversion accepts decodable images up to 10 MiB and 40 million
  decoded pixels, centers the largest crop of the target aspect ratio, and
  resizes to 64×64 PNG or 1200×630 JPEG at quality 0.85. PNG keeps transparency;
  JPEG composites transparency over the dark brand background.
- Validate converted byte limits, signatures, and dimensions before storage.
  Published files always have fixed passive image MIME types and `nosniff`.
- `services/shell/build.sh` builds `frontend.ts` separately as
  `.generated/system-customization.js`; it never enters the main shell bundle.

# Work Guidance

- Reuse semantic title fields and standard controls, messages, and navigation.

# Verification

- Run `deno task check`, `deno task test`, and
  `deno task test:branding-browser`.
- The browser fixture exercises the actual screen, database codecs, shell,
  public login images, crop geometry, save/default/cancel, retained uploads,
  invalid images, title refresh, and mobile sizing.
- `branding_native_fixture.ts` runs through the existing native browser harness
  with `--fixture=./branding_native_fixture.ts`, covering installed defaults,
  WebP uploads, public images across two nodes, reload, and reset. Follow the
  workspace CPU, memory, runtime, and fresh-instance limits.

# Child DOX Index

No child DOX documents. This document owns the entire local scope.
