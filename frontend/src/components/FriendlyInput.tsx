import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
} from "react";

type FriendlyInputProps = ComponentPropsWithoutRef<"input"> & {
  /** Select all text on focus so typing replaces the value (default: true). */
  selectOnFocus?: boolean;
};

export const FriendlyInput = forwardRef<HTMLInputElement, FriendlyInputProps>(
  function FriendlyInput(
    { selectOnFocus = true, onFocus, onMouseUp, className, ...props },
    ref,
  ) {
    const selectingRef = useRef(false);
    const classes = ["friendly-input", className].filter(Boolean).join(" ");

    return (
      <input
        ref={ref}
        className={classes}
        onFocus={(e) => {
          if (selectOnFocus) {
            selectingRef.current = true;
            e.currentTarget.select();
          }
          onFocus?.(e);
        }}
        onMouseUp={(e) => {
          if (selectingRef.current) {
            selectingRef.current = false;
            e.preventDefault();
          }
          onMouseUp?.(e);
        }}
        {...props}
      />
    );
  },
);

interface FriendlyNumberInputProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  className?: string;
  disabled?: boolean;
  id?: string;
}

export function FriendlyNumberInput({
  value,
  onChange,
  min,
  max,
  className,
  disabled,
  id,
}: FriendlyNumberInputProps) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const clamp = (n: number) => {
    let next = n;
    if (min !== undefined) next = Math.max(min, next);
    if (max !== undefined) next = Math.min(max, next);
    return next;
  };

  return (
    <FriendlyInput
      id={id}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      disabled={disabled}
      className={className}
      value={draft}
      onChange={(e) => {
        const raw = e.target.value.replace(/\D/g, "");
        setDraft(raw);
        if (raw !== "") {
          onChange(clamp(parseInt(raw, 10)));
        }
      }}
      onBlur={() => {
        const parsed = parseInt(draft, 10);
        const next = Number.isFinite(parsed) ? clamp(parsed) : (min ?? 0);
        setDraft(String(next));
        onChange(next);
      }}
    />
  );
}
