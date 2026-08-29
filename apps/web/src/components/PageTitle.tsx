import type { ReactElement } from "react";

/**
 * Sets the document title via React 19's native metadata hoisting:
 * a <title> rendered anywhere is moved into <head>.
 */
export function PageTitle({ title }: { title: string }): ReactElement {
  return <title>{title}</title>;
}
