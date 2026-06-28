import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

export type AddressConfidence =
  | "verified_rooftop"
  | "verified_parcel"
  | "interpolated"
  | "street_matched_number_unverified"
  | "street_only"
  | "ambiguous";

export interface AddressSuggestion {
  placeId: string;
  displayName: string;
  lat: number;
  lng: number;
  confidence: AddressConfidence;
  rankReason: string;
  distanceMeters?: number;
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

const DEBOUNCE_MS = 100;
const FETCH_TIMEOUT_MS = 5000;

const CONFIDENCE_LABEL: Record<AddressConfidence, string> = {
  verified_rooftop: "Exact",
  verified_parcel: "Verified",
  interpolated: "Approximate",
  street_matched_number_unverified: "Confirm",
  street_only: "Street only",
  ambiguous: "Confirm",
};

function formatDistance(meters: number | undefined): string | null {
  if (meters === undefined) return null;
  const miles = meters / 1609.344;
  if (miles < 0.1) return "< 0.1 mi";
  return `${miles.toFixed(1)} mi`;
}

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
    const fetchIdRef = useRef(0);
    const latestQueryRef = useRef("");

    const listboxId = useId();
    const inputId = useId();

    useImperativeHandle(ref, () => inputRef.current!);

    const cancelInFlight = useCallback(() => {
      abortRef.current?.abort();
      abortRef.current = null;
      fetchIdRef.current += 1;
      setFetching(false);
    }, []);

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
        const fetchId = ++fetchIdRef.current;
        latestQueryRef.current = q;
        setFetching(true);
        setIsOpen(true);

        const timeoutId = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

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

          if (fetchId !== fetchIdRef.current || latestQueryRef.current !== q) return;

          setSuggestions(data.suggestions);
          setIsOpen(data.suggestions.length > 0);
          setActiveIdx(data.suggestions.length > 0 ? 0 : -1);
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") return;
          if (fetchId === fetchIdRef.current && latestQueryRef.current === q) {
            setSuggestions((prev) => {
              if (prev.length === 0) setIsOpen(false);
              return prev;
            });
          }
        } finally {
          window.clearTimeout(timeoutId);
          if (fetchId === fetchIdRef.current) {
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
            cancelInFlight();
            setSuggestions([]);
            setIsOpen(false);
          } else {
            cancelInFlight();
          }
          return;
        }

        debounceRef.current = setTimeout(() => void fetchSuggestions(v.trim()), DEBOUNCE_MS);
      },
      [onChange, fetchSuggestions, cancelInFlight]
    );

    const selectSuggestion = useCallback(
      (s: AddressSuggestion) => {
        cancelInFlight();
        onChange(s.displayName);
        onSelect?.(s);
        setSuggestions([]);
        setIsOpen(false);
        setActiveIdx(-1);
        if (!onSelect) {
          requestAnimationFrame(() => {
            inputRef.current?.focus();
          });
        }
      },
      [onChange, onSelect, cancelInFlight]
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
            cancelInFlight();
            setIsOpen(false);
            setActiveIdx(-1);
            return;
          }
        }
        onKeyDown?.(e);
      },
      [isOpen, suggestions, activeIdx, selectSuggestion, onKeyDown, cancelInFlight]
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

    const activeOptionId =
      activeIdx >= 0 ? `${listboxId}-option-${activeIdx}` : undefined;
    const showDropdown = isOpen && (suggestions.length > 0 || fetching);

    return (
      <div style={{ position: "relative", flex: 1 }}>
        <div style={{ position: "relative" }}>
          <input
            ref={inputRef}
            id={inputId}
            className="friendly-input"
            type="text"
            role="combobox"
            aria-expanded={showDropdown}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={activeOptionId}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="words"
            spellCheck={false}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onFocus={() => {
              if (shouldFetch(value.trim())) {
                if (suggestions.length > 0) {
                  setIsOpen(true);
                } else {
                  void fetchSuggestions(value.trim());
                }
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

        {showDropdown && (
          <ul
            ref={dropdownRef}
            id={listboxId}
            role="listbox"
            aria-label="Address suggestions"
            className="address-autocomplete-dropdown"
          >
            {suggestions.map((s, i) => {
              const commaIdx = s.displayName.indexOf(",");
              const street = commaIdx > -1 ? s.displayName.slice(0, commaIdx) : s.displayName;
              const locality = commaIdx > -1 ? s.displayName.slice(commaIdx + 1).trim() : "";
              const distanceLabel = formatDistance(s.distanceMeters);
              const confidence = s.confidence ?? "ambiguous";
              const badgeClass = `address-confidence-badge address-confidence-${confidence}`;

              return (
                <li
                  key={`${s.placeId}-${i}`}
                  id={`${listboxId}-option-${i}`}
                  role="option"
                  aria-selected={i === activeIdx}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectSuggestion(s);
                  }}
                  onMouseEnter={() => setActiveIdx(i)}
                >
                  <div className="address-suggestion-row">
                    <div className="address-suggestion-main">
                      <div className="address-suggestion-street">{street}</div>
                      {locality && <div className="address-suggestion-locality">{locality}</div>}
                    </div>
                    <div className="address-suggestion-meta">
                      <span className={badgeClass}>{CONFIDENCE_LABEL[confidence]}</span>
                      {distanceLabel && (
                        <span className="address-distance-chip">{distanceLabel}</span>
                      )}
                    </div>
                  </div>
                  {s.rankReason && (
                    <div className="address-suggestion-reason">{s.rankReason}</div>
                  )}
                </li>
              );
            })}
            {fetching && suggestions.length === 0 && (
              <li className="address-autocomplete-status" aria-hidden="true">
                <span className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} />
                Searching…
              </li>
            )}
          </ul>
        )}
      </div>
    );
  }
);
