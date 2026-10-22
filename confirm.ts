import { z } from "/p/the8020/db/fields.ts";
import { Model } from "./model.ts";
import { callScreen, presentModal } from "./session.ts";

/**
 * Screen class of every confirmation: the shell renders its title at body
 * heading size, its message as ordinary text and the dialog narrow. Dialogs
 * that confirm with extra fields set it themselves.
 */
export const CONFIRM_CLASS = "uui-confirm";

export interface ConfirmOptions {
  /** Screen ID, for tests and layout overrides. */
  id?: string;
  /** A short name of what happens, such as `Delete role`. */
  title: string;
  /** The consequence, as Markdown body text. */
  message?: string;
  /** The confirming button; it names the action, never just `OK`. */
  confirm: string;
  /** `danger` (default) for destructive actions, `primary` otherwise. */
  kind?: "danger" | "primary";
  /** An explicit cancel button; closing the dialog always cancels. */
  cancel?: string;
}

/** Ask in a modal dialog; true only when the confirming button is chosen. */
export async function confirmAction(options: ConfirmOptions): Promise<boolean> {
  return await presentModal(async () =>
    (await callScreen({
      id: options.id ?? "uui-confirm",
      title: options.title,
      ...(options.message === undefined
        ? {}
        : { description: options.message }),
      class: CONFIRM_CLASS,
      schema: z.object({}),
      model: new Model({}),
      header: {
        actions: [
          {
            id: "confirm",
            label: options.confirm,
            kind: options.kind ?? "danger",
          },
          ...(options.cancel === undefined
            ? []
            : [{ id: "cancel", label: options.cancel }]),
        ],
      },
    })).action === "confirm"
  );
}
