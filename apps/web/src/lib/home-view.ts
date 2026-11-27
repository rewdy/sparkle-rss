export type HomeView = "all" | "today" | "unread";

export function homeViewFromSettings(value: unknown): HomeView {
  return value === "today" || value === "unread" ? value : "all";
}
