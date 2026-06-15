export function AppFooter() {
  return (
    <footer className="app-footer">
      <a
        className="app-footer-credit"
        href="https://stepweaver.dev"
        target="_blank"
        rel="noopener noreferrer"
      >
        <img
          src="/lambda-stepweaver.webp"
          alt=""
          width={18}
          height={18}
          className="app-footer-logo"
          aria-hidden
        />
        <span>Built by Stephen Weaver</span>
      </a>
    </footer>
  );
}
