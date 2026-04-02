import { invoke } from "@tauri-apps/api/core";

export interface SystemNotificationOptions {
  title: string;
  body?: string;
}

export async function showSystemNotification(
  options: SystemNotificationOptions
): Promise<boolean> {
  const title = options.title.trim();
  if (!title) {
    return false;
  }

  try {
    return await invoke<boolean>("show_system_notification", {
      title,
      body: options.body?.trim() || null,
    });
  } catch (error) {
    console.error("发送系统通知失败:", error);
    return false;
  }
}
