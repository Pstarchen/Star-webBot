StarBot.definePlugin({
  onEvent(event, sdk) {
    const content = String(event.data && event.data.content || "");
    if (!content.includes(String(sdk.config.keyword))) return;
    const count = sdk.kv.get("triggerCount", 0) + 1;
    sdk.kv.set("triggerCount", count);
    sdk.reply.text(`${sdk.config.reply}\n这是第 ${count} 次触发。`);
    sdk.log.info("keyword matched", { count });
  },
});
