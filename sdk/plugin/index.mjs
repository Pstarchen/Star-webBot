export function definePlugin(plugin) {
  if (!plugin || typeof plugin.onEvent !== "function") throw new TypeError("Plugin must define onEvent(event, sdk)");
  return plugin;
}
