const STEPWEAVER_URL = "https://stepweaver.dev";
const GITHUB_URL = "https://github.com/stephen";
const CONTACT_EMAIL = "hello@stepweaver.dev";

export function AppFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="app-footer">
      <div className="app-footer-inner">
        <div className="app-footer-brand">
          <a
            className="app-footer-lambda"
            href={STEPWEAVER_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            <img
              src="/lambda-stepweaver.webp"
              alt=""
              width={22}
              height={22}
              className="app-footer-logo"
              aria-hidden
            />
            <span>λstepweaver</span>
          </a>
          <span className="app-footer-sep" aria-hidden>
            ·
          </span>
          <span className="app-footer-credit">
            Built by{" "}
            <a href={STEPWEAVER_URL} target="_blank" rel="noopener noreferrer">
              Stephen Weaver
            </a>
          </span>
          <span className="app-footer-year">© {year}</span>
        </div>
        <div className="app-footer-links">
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
            GitHub
          </a>
          <a href={`mailto:${CONTACT_EMAIL}`}>Contact</a>
        </div>
      </div>
    </footer>
  );
}
