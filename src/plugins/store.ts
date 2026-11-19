/**
 * Plugin persistence — the `plugins` and `plugin-settings` stores (plan task P2).
 *
 * One record per plugin, keyed by the plugin's own id, plus one plain object of
 * per-plugin settings under the same key. Both are out-of-line stores: the key is
 * the id and nothing else, so a record cannot disagree with its key.
 *
 * Every function follows `storage/idb.ts`'s fail-soft contract: no IndexedDB (or a
 * blocked upgrade) resolves to an empty result or `false`, never a throw. The
 * browser is the only place these actually store anything — in Node they resolve
 * to their "nothing remembered" answers, which is what `scripts/test-plugins.mjs`
 * asserts.
 */
import { idbDelete, idbGet, idbGetAll, idbPut } from "../storage/idb.ts";
import { MAX_SETTINGS_BYTES, type PluginRecord } from "./model.ts";

const MAX_SETTING_KEY_LENGTH = 64;

/** Installed plugins, oldest first — the manager's stable order. */
export async function listPlugins(): Promise<PluginRecord[]> {
  const all = await idbGetAll<PluginRecord>("plugins");
  return all
    .filter((record) => typeof record?.id === "string")
    .sort((left, right) => left.installedAt - right.installedAt || left.id.localeCompare(right.id));
}

export async function getPlugin(id: string): Promise<PluginRecord | null> {
  const record = await idbGet<PluginRecord>("plugins", id);
  return record && typeof record.id === "string" ? record : null;
}

export async function countPlugins(): Promise<number> {
  return (await listPlugins()).length;
}

/** Write or replace a record. `false` means "not stored", never "stored nothing". */
export async function putPlugin(record: PluginRecord): Promise<boolean> {
  return idbPut("plugins", record, record.id);
}

/** Remove a plugin and its settings. The settings go even if the record was already gone. */
export async function deletePlugin(id: string): Promise<boolean> {
  const removed = await idbDelete("plugins", id);
  await idbDelete("plugin-settings", id);
  return removed;
}

/* ------------------------------------------------------------------ settings */

export function settingsBytes(values: Record<string, unknown>): number {
  try {
    return new TextEncoder().encode(JSON.stringify(values)).length;
  } catch {
    // Circular or otherwise unserialisable: "too big" is the safe answer, because
    // the alternative is silently storing a value that cannot come back.
    return Number.POSITIVE_INFINITY;
  }
}

export async function readSettings(pluginId: string): Promise<Record<string, unknown>> {
  const values = await idbGet<Record<string, unknown>>("plugin-settings", pluginId);
  return values && typeof values === "object" && !Array.isArray(values) ? { ...values } : {};
}

/**
 * Set one key. Refuses a key that is not a short string, and a value that would
 * push the plugin over its settings cap — the cap is checked *before* the write,
 * so a refused write cannot leave half a value behind.
 */
export async function writeSetting(
  pluginId: string,
  key: string,
  value: unknown,
): Promise<boolean> {
  if (typeof key !== "string" || key.length === 0 || key.length > MAX_SETTING_KEY_LENGTH) {
    return false;
  }
  const current = await readSettings(pluginId);
  const next = { ...current, [key]: value };
  if (settingsBytes(next) > MAX_SETTINGS_BYTES) return false;
  return idbPut("plugin-settings", next, pluginId);
}

export async function removeSetting(pluginId: string, key: string): Promise<boolean> {
  const current = await readSettings(pluginId);
  if (!(key in current)) return true;
  const next = { ...current };
  delete next[key];
  return idbPut("plugin-settings", next, pluginId);
}

export async function clearSettings(pluginId: string): Promise<boolean> {
  return idbDelete("plugin-settings", pluginId);
}
