import { useEffect } from "react";

const APP_SUFFIX = "Parcel Sweep";

export function useDocumentTitle(title: string): void {
  useEffect(() => {
    const previous = document.title;
    document.title = title ? `${title} — ${APP_SUFFIX}` : APP_SUFFIX;
    return () => {
      document.title = previous;
    };
  }, [title]);
}
