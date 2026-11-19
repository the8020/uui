Parent DOX: [UUI programs](../AGENTS.md).

# Purpose

- Edit the system-wide server title, navbar logo, favicon, and social preview
  from Administration.

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
- Upload raw images through the existing bounded file receiver. On a screen
  action, `src/branding_conversion.ts` decodes on the backend with at most 10
  MiB input, 40 million pixels and one codec thread. Favicon and social use
  centered crops to 64×64 PNG and 1200×630 JPEG at quality 85. PNG preserves
  transparency; JPEG composites it over the dark brand background.
- Logo ratios from 1:1 through 3:1 are preserved, including 16:9. Crop the
  longer side centrally only when outside that range, to its nearest boundary.
  Resize within 384×128 and encode PNG. A null logo restores the textual navbar
  wordmark; saving other fields preserves the logo.
- Title spans the Browser grid; logo and favicon occupy equal two-row fields
  beneath it. Their clickable previews open the ordinary file picker. The
  preview/chooser grid stays within the custom field's one underline. Draft
  previews use blob URLs; converted previews arrive through the same Channel.
- Validate converted byte limits, signatures, and dimensions before storage.
  Published files always have fixed passive image MIME types and `nosniff`.
- `services/shell/build.sh` builds `frontend.ts` separately as
  `.generated/system-customization.js` and copies `frontend.css`; neither enters
  the main shell bundle.

# Work Guidance

- Reuse semantic title fields and standard controls, messages, and navigation.

# Verification

- Run `deno task check`, `deno task test`, and
  `deno task test:branding-browser`.
- The browser fixture exercises the actual screen, database codecs, shell,
  public login images, crop geometry, save/default/cancel, retained uploads,
  invalid images, title refresh, and mobile sizing. Screenshots are written to
  `/tmp/uui-branding-{desktop,mobile}.png`.
- `branding_native_fixture.ts` runs through the existing native browser harness
  with `--fixture=./branding_native_fixture.ts`, covering installed defaults,
  WebP uploads, public images across two nodes, reload, and reset. Follow the
  workspace CPU, memory, runtime, and fresh-instance limits.

# Child DOX Index

No child DOX documents. This document owns the entire local scope.
