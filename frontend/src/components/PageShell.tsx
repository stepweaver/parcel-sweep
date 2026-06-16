import type { ReactNode } from "react";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

interface PageShellProps {
  title: string;
  subtitle?: ReactNode;
  documentTitle?: string;
  actions?: ReactNode;
  backLink?: ReactNode;
  children: ReactNode;
}

export function PageShell({
  title,
  subtitle,
  documentTitle,
  actions,
  backLink,
  children,
}: PageShellProps) {
  useDocumentTitle(documentTitle ?? title);

  return (
    <main id="main-content" className="page">
      <div className="page-header">
        <div>
          {backLink}
          <h1 className="page-title">{title}</h1>
          {subtitle && <div className="page-subtitle">{subtitle}</div>}
        </div>
        {actions && <div className="page-header__actions">{actions}</div>}
      </div>
      {children}
    </main>
  );
}
