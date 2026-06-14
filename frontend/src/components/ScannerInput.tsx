import { useRef, useState } from "react";

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
    <div style={{ display: "flex", gap: ".5rem", marginBottom: "1rem" }}>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus
        style={{ fontFamily: "monospace", fontSize: "1.05rem" }}
      />
      <button
        className="btn-primary"
        onClick={submit}
        disabled={disabled || !value.trim()}
        style={{ flexShrink: 0 }}
      >
        Scan
      </button>
    </div>
  );
}
