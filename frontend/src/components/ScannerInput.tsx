import { useRef, useState } from "react";
import { FriendlyInput } from "./FriendlyInput";

interface ScannerInputProps {
  onScan: (trackingNumber: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function ScannerInput({ onScan, disabled, placeholder = "Scan or type tracking number…" }: ScannerInputProps) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onScan(trimmed);
    setValue("");
    inputRef.current?.focus();
  };

  return (
    <div className="scanner-input">
      <FriendlyInput
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus
        className="scanner-input__field"
      />
      <button
        className="btn-primary scanner-input__btn"
        onClick={submit}
        disabled={disabled || !value.trim()}
      >
        Scan
      </button>
    </div>
  );
}
