import type { ReactElement } from "react";
import { LuRss } from "react-icons/lu";

export function FeedIcon({
  iconUrl,
  size = 14,
}: {
  iconUrl?: string | null;
  size?: number;
}): ReactElement {
  if (!iconUrl) {
    return <LuRss size={size} style={{ flexShrink: 0, opacity: 0.6 }} />;
  }
  return (
    <img
      src={iconUrl}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      style={{ flexShrink: 0, borderRadius: 2, objectFit: "contain" }}
      onError={(e) => {
        e.currentTarget.style.display = "none";
      }}
    />
  );
}
