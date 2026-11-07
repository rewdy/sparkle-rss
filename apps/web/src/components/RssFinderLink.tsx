import { Anchor } from "@mantine/core";
import { isHttpUrl, rssFinderUrl } from "../lib/subscription-discovery";

export function RssFinderLink({ sourceUrl }: { sourceUrl: string }) {
  if (!isHttpUrl(sourceUrl)) return null;
  return (
    <Anchor
      href={rssFinderUrl(sourceUrl)}
      target="_blank"
      rel="noopener noreferrer"
      size="sm"
    >
      Use RSSFinder.com
    </Anchor>
  );
}
