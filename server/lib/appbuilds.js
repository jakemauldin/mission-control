// appbuilds.js — read-only App Builds metadata; patches are fetched per PR.
import { readFileSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export const getAppBuildsDir = () => process.env.APP_BUILDS_DIR || join(homedir(), "services", "projects", "app-builds");

const emptyData = () => ({ generated: null, since: null, prs: [], branches: [] });
let dataCache = null;

function readSection(dir, file, fallback, errors) {
  try { return JSON.parse(readFileSync(join(dir, file), "utf-8")); } catch (e) {
    errors.push({ file, message: e.message });
    return fallback;
  }
}

function readData(dir, errors) {
  const path = join(dir, "data.json");
  try {
    const { mtimeMs, size } = statSync(path);
    if (dataCache?.path === path && dataCache.mtimeMs === mtimeMs && dataCache.size === size) return dataCache.data;
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    const data = {
      generated: raw.generated ?? null, since: raw.since ?? null,
      prs: (raw.prs || []).map(({ files, ...pr }) => ({ ...pr, file_count: Array.isArray(files) ? files.length : 0 })),
      branches: raw.branches || [],
    };
    dataCache = { path, mtimeMs, size, data };
    return data;
  } catch (e) {
    errors.push({ file: "data.json", message: e.message });
    // A partial write must not evict the last good slim copy; a missing file is empty.
    return e.code !== "ENOENT" && dataCache?.path === path ? dataCache.data : emptyData();
  }
}

export function getApps() {
  const dir = getAppBuildsDir();
  const errors = [];
  const apps = readSection(dir, "apps.json", [], errors);
  const status = readSection(dir, "status.json", {}, errors);
  const data = readData(dir, errors);
  return { ...data, apps, status, ...(errors.length ? { errors } : {}) };
}

export function getPrFiles(repo, number) {
  try {
    const data = JSON.parse(readFileSync(join(getAppBuildsDir(), "data.json"), "utf-8"));
    const pr = data.prs.find((p) => p.repo === repo && p.number === Number(number));
    return pr ? { files: pr.files || [], more_files: pr.more_files ?? 0 } : null;
  } catch { return null; }
}
