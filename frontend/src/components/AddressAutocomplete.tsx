import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

export interface AddressSuggestion {
  placeId: string;
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
  city?: string;
  state?: string;
}

const DEBOUNCE_MS = 150;

/** Avoid fetching on bare house numbers like "302" — wait for street input. */
function shouldFetch(q: string): boolean {
  const t = q.trim();
  if (t.length < 3) return false;
  if (/^\d+[a-zA-Z]?\s+\S/.test(t)) return true;
  if (t.length >= 4 && !/^\d+$/.test(t)) return true;
  return false;
}

export const AddressAutocomplete = forwardRef<HTMLInputElement, AddressAutocompleteProps>(
  function AddressAutocomplete(
    { value, onChange, onSelect, onKeyDown, placeholder, style, near, city, state },
    ref
  ) {
    const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
    const [activeIdx, setActiveIdx] = useState(-1);
    const [isOpen, setIsOpen] = useState(false);
    const [fetching, setFetching] = useState(false);

    const inputRef = useRef<HTMLInputElement>(null);
    const dropdownRef = useRef<HTMLUListElement>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const abortRef = useRef<AbortController | null>(null);
    const latestQueryRef = useRef("");

    useImperativeHandle(ref, () => inputRef.current!);

    const fetchSuggestions = useCallback(
      async (q: string) => {
        if (!shouldFetch(q)) {
          if (!/^\d+[a-zA-Z]?\s*$/.test(q.trim())) {
            setSuggestions([]);
            setIsOpen(false);
          }
          return;
        }

        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        latestQueryRef.current = q;
        setFetching(true);

        try {
          const params = new URLSearchParams({ q });
          if (near) {
            params.set("near_lat", String(near.lat));
            params.set("near_lng", String(near.lng));
          }
          if (city) params.set("city", city);
          if (state) params.set("state", state);

          const res = await fetch(`/api/geocode/autocomplete?${params.toString()}`, {
            signal: controller.signal,
            headers: { "Content-Type": "application/json" },
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = (await res.json()) as { suggestions: AddressSuggestion[] };

          if (latestQueryRef.current !== q || controller.signal.aborted) return;
          setSuggestions(data.suggestions);
          setIsOpen(data.suggestions.length > 0);
          setActiveIdx(data.suggestions.length > 0 ? 0 : -1);
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") return;
          if (latestQueryRef.current === q) {
            setSuggestions([]);
            setIsOpen(false);
          }
        } finally {
          if (latestQueryRef.current === q && !controller.signal.aborted) {
            setFetching(false);
          }
        }
      },
      [near, city, state]
    );

    const handleChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        const v = e.target.value;
        onChange(v);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        if (!shouldFetch(v.trim())) {
          if (!/^\d+[a-zA-Z]?\s*$/.test(v.trim())) {
            abortRef.current?.abort();
            setSuggestions([]);
            setIsOpen(false);
          }
          setFetching(false);
          return;
        }
        debounceRef.current = setTimeout(() => void fetchSuggestions(v.trim()), DEBOUNCE_MS);
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
            setActiveIdx((i) => Math.max(i - 1, 0));
            return;
          }
          if (e.key === "Enter" && activeIdx >= 0) {
            e.preventDefault();
            selectSuggestion(suggestions[activeIdx]);
            return;
          }
          if (e.key === "Tab" && activeIdx >= 0) {
            selectSuggestion(suggestions[activeIdx]);
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

    useEffect(() => {
      if (activeIdx >= 0 && dropdownRef.current) {
        const el = dropdownRef.current.children[activeIdx] as HTMLElement | undefined;
        el?.scrollIntoView({ block: "nearest" });
      }
    }, [activeIdx]);

    useEffect(() => {
      return () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        abortRef.current?.abort();
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
              if (shouldFetch(value.trim()) && suggestions.length === 0) {
                void fetchSuggestions(value.trim());
              } else if (suggestions.length > 0) {
                setIsOpen(true);
              }
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
            className="address-autocomplete-dropdown"
          >
            {suggestions.map((s, i) => {
              const commaIdx = s.displayName.indexOf(",");
              const street = commaIdx > -1 ? s.displayName.slice(0, commaIdx) : s.displayName;
              const locality = commaIdx > -1 ? s.displayName.slice(commaIdx + 1).trim() : "";

              return (
                <li
                  key={`${s.placeId}-${i}`}
                  role="option"
                  aria-selected={i === activeIdx}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectSuggestion(s);
                  }}
                  onMouseEnter={() => setActiveIdx(i)}
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
