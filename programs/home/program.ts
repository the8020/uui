import {
  BACK_EVENT,
  callScreen,
  discoverPrograms,
  endSession,
  invokeProgram,
  Model,
  z,
} from "/p/the8020/uui/mod.ts";
import layout from "./layouts/main.json" with { type: "json" };

const HomeScreen = z.object({
  programs: z.array(z.object({ id: z.string(), description: z.string() })),
});

export default function home(): Promise<void> {
  return runHome("/workspace/packages");
}

export async function runHome(programsRoot: string): Promise<void> {
  let screenModel: Model<z.infer<typeof HomeScreen>> | undefined;
  while (true) {
    const model = { programs: await discoverPrograms(programsRoot) };
    screenModel ??= new Model(model);
    screenModel.data = model;
    const event = await callScreen({
      id: "home",
      title: "Welcome to 80|20",
      schema: HomeScreen,
      model: screenModel,
      layout,
      header: {
        actions: [
          {
            id: "refresh",
            label: "[[icon=refresh color=warning]] Refresh",
          },
          { id: "logout", label: "Logout" },
        ],
      },
    });
    if (event.action === BACK_EVENT) continue;
    if (event.action === "logout") {
      endSession("Signing out…", "/the8020/uui/login/logout");
      return;
    }
    if (event.action === "select" && typeof event.value === "string") {
      if (!model.programs.some((program) => program.id === event.value)) {
        continue;
      }
      await invokeProgram(event.value, [], programsRoot);
    }
  }
}
