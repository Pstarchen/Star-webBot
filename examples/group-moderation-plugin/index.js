function commandMatches(content, command) {
  return content === command || content.startsWith(command + " ");
}

function actorCanModerate(author, allowGroupAdmins) {
  const role = String(author && author.member_role || "").toLowerCase();
  return role === "owner" || (allowGroupAdmins && role === "admin");
}

function mentionedTarget(data) {
  const mentions = Array.isArray(data.mentions) ? data.mentions.filter((item) => item && typeof item === "object") : [];
  if (mentions.length !== 1) return { error: mentions.length ? "每次只能指定一名成员。" : "请在命令中 @ 一名普通群成员。" };
  const target = mentions[0];
  const memberOpenid = String(target.member_openid || "");
  const role = String(target.member_role || "").toLowerCase();
  if (!memberOpenid) return { error: "QQ 事件未提供目标成员 OpenID，无法执行操作。" };
  if (target.bot || role !== "member") return { error: "只能操作普通群成员，不能操作群主、管理员或机器人。" };
  return { memberOpenid, username: String(target.username || "该成员") };
}

function durationFrom(content, command, defaultMinutes, maxMinutes) {
  const remainder = content.slice(command.length).trim();
  const match = remainder.match(/(?:^|\s)(\d+)\s*(s|m|h|d|秒|分钟|小时|天)$/i);
  const textWithoutMentions = remainder.replace(/<@!?[^>]+>/g, "").replace(/@\S+/g, "").trim();
  if (!match) {
    if (textWithoutMentions) return { error: "禁言时长格式无效，请使用 30s、10m、2h 或 1d。" };
    return { milliseconds: Math.min(defaultMinutes, maxMinutes) * 60 * 1000 };
  }
  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  const factors = { s: 1000, "秒": 1000, m: 60 * 1000, "分钟": 60 * 1000, h: 60 * 60 * 1000, "小时": 60 * 60 * 1000, d: 24 * 60 * 60 * 1000, "天": 24 * 60 * 60 * 1000 };
  const milliseconds = value * factors[unit];
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 1000) return { error: "禁言时长必须大于 0。" };
  if (milliseconds > maxMinutes * 60 * 1000) return { error: `禁言时长不能超过 ${maxMinutes} 分钟。` };
  return { milliseconds };
}

function readableDuration(milliseconds) {
  if (milliseconds % (24 * 60 * 60 * 1000) === 0) return `${milliseconds / (24 * 60 * 60 * 1000)} 天`;
  if (milliseconds % (60 * 60 * 1000) === 0) return `${milliseconds / (60 * 60 * 1000)} 小时`;
  if (milliseconds % (60 * 1000) === 0) return `${milliseconds / (60 * 1000)} 分钟`;
  return `${milliseconds / 1000} 秒`;
}

function qqFailureMessage(action, error) {
  const traceHint = error && error.traceId ? "，请在平台事件日志中按 Trace ID 排查" : "";
  return `${action}失败，请确认机器人具有群管理员权限且目标是普通成员${traceHint}。`;
}

StarBot.definePlugin({
  async onEvent(event, sdk) {
    if (event.type !== "GROUP_AT_MESSAGE_CREATE") return;
    const data = event.data && typeof event.data === "object" ? event.data : {};
    const content = String(data.content || "").trim();
    const muteCommand = String(sdk.config.muteCommand || "/禁言").trim();
    const unmuteCommand = String(sdk.config.unmuteCommand || "/解禁").trim();
    const statusCommand = String(sdk.config.statusCommand || "/禁言状态").trim();
    const isMute = commandMatches(content, muteCommand);
    const isUnmute = commandMatches(content, unmuteCommand);
    const isStatus = content === statusCommand;
    if (!isMute && !isUnmute && !isStatus) return;

    const author = data.author && typeof data.author === "object" ? data.author : {};
    if (!actorCanModerate(author, sdk.config.allowGroupAdmins !== false)) {
      sdk.reply.text("仅群主或已获授权的群管理员可以执行该命令。");
      return;
    }

    const groupOpenid = String(data.group_openid || data.group_id || "");
    if (!groupOpenid) {
      sdk.reply.text("QQ 事件未提供群 OpenID，无法执行操作。");
      return;
    }

    if (isStatus) {
      try {
        const result = await sdk.qq.getGroupMuteSettings(groupOpenid);
        const members = Array.isArray(result.body && result.body.members) ? result.body.members : [];
        sdk.reply.text(`当前群有 ${members.length} 名成员处于禁言状态。`);
        sdk.log.info("group mute status queried", { mutedMemberCount: members.length, traceIdPresent: Boolean(result.traceId) });
      } catch (error) {
        sdk.reply.text(qqFailureMessage("查询", error));
        sdk.log.error("group mute status query failed", { status: error && error.status, traceIdPresent: Boolean(error && error.traceId) });
      }
      return;
    }

    const target = mentionedTarget(data);
    if (target.error) {
      sdk.reply.text(target.error);
      return;
    }
    const actorOpenid = String(author.member_openid || author.id || "");
    if (actorOpenid && actorOpenid === target.memberOpenid) {
      sdk.reply.text("不能对自己执行该操作。");
      return;
    }

    if (isUnmute) {
      try {
        const result = await sdk.qq.unmuteGroupMember(groupOpenid, target.memberOpenid);
        sdk.reply.text(`已解除 ${target.username} 的禁言。`);
        sdk.log.info("group member unmuted", { traceIdPresent: Boolean(result.traceId) });
      } catch (error) {
        sdk.reply.text(qqFailureMessage("解禁", error));
        sdk.log.error("group member unmute failed", { status: error && error.status, traceIdPresent: Boolean(error && error.traceId) });
      }
      return;
    }

    const defaultMinutes = Math.max(1, Number(sdk.config.defaultDurationMinutes || 10));
    const maxMinutes = Math.max(1, Number(sdk.config.maxDurationMinutes || 1440));
    const duration = durationFrom(content, muteCommand, defaultMinutes, maxMinutes);
    if (duration.error) {
      sdk.reply.text(duration.error);
      return;
    }

    try {
      const result = await sdk.qq.muteGroupMember(groupOpenid, target.memberOpenid, new Date(Date.now() + duration.milliseconds).toISOString());
      sdk.reply.text(`已禁言 ${target.username} ${readableDuration(duration.milliseconds)}。`);
      sdk.log.info("group member muted", { durationSeconds: duration.milliseconds / 1000, traceIdPresent: Boolean(result.traceId) });
    } catch (error) {
      sdk.reply.text(qqFailureMessage("禁言", error));
      sdk.log.error("group member mute failed", { status: error && error.status, traceIdPresent: Boolean(error && error.traceId) });
    }
  },
});
