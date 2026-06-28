import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { api } from "../api";

export interface AddressSuggestion {
  placeId: number;
  displayName: string;
  lat: number;
  lng: number;
}

interface AddressAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onSelect?: (suggestion: AddressSuggestion) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  placeholder?: string;
  style?: React.CSSProperties;
  /** Bias suggestions toward this point (e.g. the selected station coords). */
  near?: { lat: number; lng: number };
}

const MIN_CHARS = 4;
const DEBOUNCE_MS = 350;

export const AddressAutocomplete = forwardRef<HTMLInputElement, AddressAutocompleteProps>(
  function AddressAutocomplete(
    { value, onChange, onSelect, onKeyDown, placeholder, style, near },
    ref
  ) {
    const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
    const [activeIdx, setActiveIdx] = useState(-1);
    const [isOpen, setIsOpen] = useState(false);
    const [fetching, setFetching] = useState(false);

    const inputRef = useRef<HTMLInputElement>(null);
    const dropdownRef = useRef<HTMLUListElement>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const latestQueryRef = useRef("");

    useImperativeHandle(ref, () => inputRef.current!);

    const fetchSuggestions = useCallback(
      async (q: string) => {
        if (q.length < MIN_CHARS) {
          setSuggestions([]);
          setIsOpen(false);
          return;
        }
        latestQueryRef.current = q;
        setFetching(true);
        try {
          const { suggestions: results } = await api.geocode.autocomplete(q, near);
          // Ignore stale responses
          if (latestQueryRef.current !== q) return;
          setSuggestions(results);
          setIsOpen(results.length > 0);
          setActiveIdx(-1);
        } catch {
          setSuggestions([]);
          setIsOpen(false);
        } finally {
          if (latestQueryRef.current === q) setFetching(false);
        }
      },
      [near]
    );

    const handleChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        const v = e.target.value;
        onChange(v);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        if (v.length < MIN_CHARS) {
          setSuggestions([]);
          setIsOpen(false);
          setFetching(false);
          return;
        }
        debounceRef.current = setTimeout(() => void fetchSuggestions(v), DEBOUNCE_MS);
      },
      [onChange, fetchSuggestions]
    );

    const selectSuggestion = useCallback(
      (s: AddressSuggestion) => {
        onChange(s.displayName);
        onSelect?.(s);
        setSuggestions([]);
        setIsOpen(false);
        setActiveIdx(-1);
        // Move focus back to input and advance to next stop
        requestAnimationFrame(() => {
          inputRef.current?.focus();
        });
      },
      [onChange, onSelect]
    );

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (isOpen && suggestions.length > 0) {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1));
            return;
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            setActiveIdx((i) => Math.max(i - 1, -1));
            return;
          }
          if (e.key === "Enter" && activeIdx >= 0) {
            e.preventDefault();
            selectSuggestion(suggestions[activeIdx]);
            // Don't bubble Enter to the parent (it would add a new stop)
            return;
          }
          if (e.key === "Escape") {
            setIsOpen(false);
            setActiveIdx(-1);
            return;
          }
        }
        onKeyDown?.(e);
      },
      [isOpen, suggestions, activeIdx, selectSuggestion, onKeyDown]
    );

    // Close dropdown when clicking outside
    useEffect(() => {
      const handler = (e: MouseEvent) => {
        if (
          inputRef.current &&
          !inputRef.current.contains(e.target as Node) &&
          dropdownRef.current &&
          !dropdownRef.current.contains(e.target as Node)
        ) {
          setIsOpen(false);
        }
      };
      document.addEventListener("mousedown", handler);
      return () => document.removeEventListener("mousedown", handler);
    }, []);

    // Scroll active item into view
    useEffect(() => {
      if (activeIdx >= 0 && dropdownRef.current) {
        const el = dropdownRef.current.children[activeIdx] as HTMLElement | undefined;
        el?.scrollIntoView({ block: "nearest" });
      }
    }, [activeIdx]);

    // Cleanup debounce on unmount
    useEffect(() => {
      return () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
      };
    }, []);

    return (
      <div style={{ position: "relative", flex: 1 }}>
        <div style={{ position: "relative" }}>
          <input
            ref={inputRef}
            className="friendly-input"
            type="text"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="words"
            spellCheck={false}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onFocus={() => {
              if (suggestions.length > 0) setIsOpen(true);
            }}
            placeholder={placeholder}
            style={{ width: "100%", paddingRight: fetching ? "2rem" : undefined, ...style }}
          />
          {fetching && (
            <span
              style={{
                position: "absolute",
                right: ".6rem",
                top: "50%",
                transform: "translateY(-50%)",
                pointerEvents: "none",
              }}
            >
              <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
            </span>
          )}
        </div>

        {isOpen && suggestions.length > 0 && (
          <ul
            ref={dropdownRef}
            role="listbox"
            style={{
              position: "absolute",
              top: "calc(100% + 4px)",
              left: 0,
              right: 0,
              margin: 0,
              padding: 0,
              listStyle: "none",
              background: "var(--surface)",
              border: "1.5px solid var(--usps-blue)",
              borderRadius: "var(--radius)",
              boxShadow: "var(--shadow-lg)",
              zIndex: 300,
              maxHeight: 260,
              overflowY: "auto",
            }}
          >
            {suggestions.map((s, i) => {
              // Split displayName into street line and locality line
              const commaIdx = s.displayName.indexOf(",");
              const street = commaIdx > -1 ? s.displayName.slice(0, commaIdx) : s.displayName;
              const locality = commaIdx > -1 ? s.displayName.slice(commaIdx + 1).trim() : "";

              return (
                <li
                  key={s.placeId}
                  role="option"
                  aria-selected={i === activeIdx}
                  onMouseDown={(e) => {
                    e.preventDefault(); // prevent input blur before click fires
                    selectSuggestion(s);
                  }}
                  onMouseEnter={() => setActiveIdx(i)}
                  style={{
                    padding: ".55rem .75rem",
                    cursor: "pointer",
                    background: i === activeIdx ? "var(--hover-bg)" : "transparent",
                    borderBottom:
                      i < suggestions.length - 1 ? "1px solid var(--row-border)" : "none",
                    transition: "background .1s",
                  }}
                >
                  <div
                    style={{
                      fontSize: ".875rem",
                      fontWeight: 600,
                      color: "var(--text)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {street}
                  </div>
                  {locality && (
                    <div
                      style={{
                        fontSize: ".78rem",
                        color: "var(--text-muted)",
                        marginTop: ".1rem",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {locality}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  }
);
