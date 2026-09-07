import { readFile } from "fs/promises";
import { join } from "path";

const worldMapTemplatePath = join(__dirname, "map-assets", "ProjectGC_World.svg");
let worldMapTemplatePromise: Promise<string> | null = null;

export function loadWorldMapTemplate() {
  if (!worldMapTemplatePromise) {
    worldMapTemplatePromise = readFile(worldMapTemplatePath, "utf8").catch((error) => {
      worldMapTemplatePromise = null;
      throw error;
    });
  }
  return worldMapTemplatePromise;
}
