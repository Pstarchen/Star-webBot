StarBot.definePlugin({
  onEvent(event, sdk) {
    const data = event.data || {};
    const content = String(data.content || "").trim();
    const author = data.author || {};
    const userId = String(author.user_openid || author.member_openid || author.id || data.openid || "anonymous");
    const storageKey = `checkin:${userId}`;
    const record = sdk.kv.get(storageKey, { count: 0, lastDate: "" });
    const today = new Date().toISOString().slice(0, 10);

    if (content === String(sdk.config.statusCommand)) {
      sdk.reply.text(record.count
        ? `你已累计签到 ${record.count} 天，最近签到日期：${record.lastDate}。`
        : "你还没有签到记录，发送“签到”开始吧。");
      return;
    }

    if (content !== String(sdk.config.checkinCommand)) return;
    if (record.lastDate === today) {
      sdk.reply.text(`今天已经签到过了，累计 ${record.count} 天。`);
      return;
    }

    const nextRecord = { count: Number(record.count || 0) + 1, lastDate: today };
    sdk.kv.set(storageKey, nextRecord);
    sdk.reply.text(`${sdk.config.successMessage}，这是第 ${nextRecord.count} 天。`);
    sdk.log.info("daily check-in completed", { userId, count: nextRecord.count });
  },
});
